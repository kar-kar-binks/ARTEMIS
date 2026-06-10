import openai
import json
import os

# Ollama client uses the OpenAI-compatible REST API that Ollama exposes at port 11434.
# Override OLLAMA_BASE_URL env var to point at a remote Ollama instance if needed.
_ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
_ollama_client = openai.OpenAI(base_url=_ollama_base_url, api_key="ollama")

#localMessages: list[{"role":"system"|"user"|"assistant", "text":str}]

def format_localmessages_to_openai(local_messages):
    res = []
    for i in range(len(local_messages)):
        oai_message = \
        {
            "role":local_messages[i]["role"],
            "content": [
                {
                    "type":"text",
                    "text":local_messages[i]["text"]
                }
            ]
        }
        res.append(oai_message)
    return res

def _resolve_schema_refs(schema):
    """Inline all $defs/$ref entries so the schema is fully explicit with no references."""
    defs = schema.get("$defs", {})
    def resolve(obj):
        if isinstance(obj, dict):
            if "$ref" in obj:
                ref_name = obj["$ref"].split("/")[-1]
                return resolve(defs.get(ref_name, obj))
            return {k: resolve(v) for k, v in obj.items() if k != "$defs"}
        if isinstance(obj, list):
            return [resolve(item) for item in obj]
        return obj
    return resolve(schema)

# Sends a prompt to a locally-running Ollama model via its OpenAI-compatible endpoint.
# Uses Ollama's native structured output (json_schema response_format) which applies
# constrained grammar decoding to guarantee the output matches the schema exactly.
# Falls back to json_object + text injection if the model/version doesn't support it.
def query_ollama(local_messages, schema=None, model="llama3.2", max_empty_retry=2):
    messages = format_localmessages_to_openai(local_messages)
    if schema is not None and hasattr(schema, "model_json_schema"):
        schema_json = _resolve_schema_refs(schema.model_json_schema())
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "output",
                "strict": True,
                "schema": schema_json,
            },
        }
    else:
        response_format = {"type": "json_object"}
    raw = ""
    for attempt in range(max_empty_retry + 1):
        response = _ollama_client.chat.completions.create(
            model=model,
            messages=messages,
            response_format=response_format,
        )
        raw = response.choices[0].message.content
        if raw:
            break
        print(f"query_ollama: empty response from Ollama (attempt {attempt+1}/{max_empty_retry+1}). "
              f"finish_reason={response.choices[0].finish_reason!r}")
    return raw

def get_formalizations_loop(input_nl,ap_dict,translation_func,num_trial=5,model="gpt-4o-mini",prev_outputs=None,max_empty_attempts=5,**kwargs):
    if prev_outputs is None:
        prev_outputs = []
    cur_set = set([output["output_LTL"] for output in prev_outputs])
    empty_attempts = 0
    while len(prev_outputs) < num_trial:
        cur_output = translation_func(input_nl,ap_dict,model=model,max_retry=3,prev_outputs=prev_outputs,k=num_trial,**kwargs)
        if len(cur_output) == 0:
            empty_attempts += 1
            if empty_attempts >= max_empty_attempts:
                print(f"get_formalizations_loop: giving up after {empty_attempts} attempts with no valid output.")
                break
            continue
        empty_attempts = 0
        new_set = set([output["output_LTL"] for output in cur_output])
        #if len(cur_set) > 0 and len(new_set - cur_set) == 0:
        #    break
        prev_outputs += cur_output
        cur_set.update(new_set)
    return prev_outputs[:num_trial]

def prompt_loop(system_prompt, user_prompt, model, max_retry, check_output_func, schema, **kwargs):
    #print(system_prompt)
    #print(user_prompt)
    # All model names are routed to Ollama (local inference) via its
    # OpenAI-compatible endpoint, e.g. "qwen2.5:32b".
    local_messages = [{"role":"system","text":system_prompt}, {"role":"user", "text":user_prompt}]
    for trial in range(max_retry):
        raw_output = query_ollama(local_messages, schema=schema, model=model)
        error_msg = check_output_func(raw_output, **kwargs)
        if error_msg is None:
            break
        else:
            print("error msg:", error_msg)
            local_messages.append({"role":"assistant", "text":raw_output})
            local_messages.append({"role":"user", "text":error_msg})
    #if error_msg is None:
    #    output = raw_output
    #else:
    #    output = None
    #return output
    try:
        json.loads(raw_output)
        is_valid_json = True
    except:
        is_valid_json = False
    if is_valid_json:
        return raw_output
    else:
        return None