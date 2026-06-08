from tqdm import tqdm
import openai
from google import genai
import json
import time
import os

if os.getenv("OPENAI_API_KEY") is not None:
    client = openai.OpenAI()
else:
    print("WARNING: no OPENAI_API_KEY found!")

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

def query_openai(local_messages,schema,model="gpt-4o-mini"):
    messages = format_localmessages_to_openai(local_messages)
    if schema is not None:
        response_format = schema
    else:
        response_format={
            "type": "json_object"
        }
    response = client.beta.chat.completions.parse(  
      model=model,
      messages=messages,
      #temperature=1.5,
      response_format=response_format,
      #response_format=schema,
      #response_format={
      #  "type": "json_object"
      #},
    )
    return response.choices[0].message.content

# Sends a prompt to a locally-running Ollama model via its OpenAI-compatible endpoint.
# Because Ollama does not support structured-output natively, the Pydantic JSON schema
# is injected as plain text into the system message so the model copies enum values exactly.
def query_ollama(local_messages, schema=None, model="llama3.2"):
    messages = format_localmessages_to_openai(local_messages)
    if schema is not None and hasattr(schema, "model_json_schema"):
        schema_json = schema.model_json_schema()
        # Inject schema into the system message so the model knows exact enum values
        schema_instruction = (
            f"\nYou MUST respond with valid JSON that strictly conforms to this JSON schema "
            f"(pay special attention to enum values — copy them exactly as written):\n"
            f"{json.dumps(schema_json, indent=2)}"
        )
        # Prepend to existing system message or add a new one
        if messages and messages[0]["role"] == "system":
            messages[0]["content"][0]["text"] += schema_instruction
        else:
            messages.insert(0, {"role": "system", "content": [{"type": "text", "text": schema_instruction}]})
    response_format = {"type": "json_object"}
    response = _ollama_client.chat.completions.create(
        model=model,
        messages=messages,
        response_format=response_format,
    )
    return response.choices[0].message.content

def get_formalizations_loop(input_nl,ap_dict,translation_func,num_trial=5,model="gpt-4o-mini",prev_outputs=None,**kwargs):
    if prev_outputs is None:
        prev_outputs = []
    cur_set = set([output["output_LTL"] for output in prev_outputs])
    while len(prev_outputs) < num_trial:
        cur_output = translation_func(input_nl,ap_dict,model=model,max_retry=3,prev_outputs=prev_outputs,k=num_trial,**kwargs)
        new_set = set([output["output_LTL"] for output in cur_output])
        #if len(cur_set) > 0 and len(new_set - cur_set) == 0:
        #    break
        prev_outputs += cur_output
        cur_set.update(new_set)
    return prev_outputs[:num_trial]

def prompt_loop(system_prompt, user_prompt, model, max_retry, check_output_func, schema, **kwargs):
    #print(system_prompt)
    #print(user_prompt)
    if model in ["deepstl-gemini-2.5-flash", "deepstl-gemini-2.0-flash-lite-001"]:
        client = genai.Client(
          vertexai=True,
          project="378594934615",
          location="us-central1",
        )
        if model == "deepstl-gemini-2.0-flash-lite-001":
            endpoint_id = "2144959169302626304"
            generate_content_config = genai.types.GenerateContentConfig(
                #temperature = 0.5,
            )
        elif model == "deepstl-gemini-2.5-flash":
            endpoint_id = "5270457310697750528"
            generate_content_config = genai.types.GenerateContentConfig(
                response_mime_type= "application/json",
            )
        else:
            assert False, "deepstl model not found!"
        internal_model = f"projects/378594934615/locations/us-central1/endpoints/{endpoint_id}"
        chat = client.chats.create(model=internal_model)
        is_recv_response = False
        while not is_recv_response:
            try:
                raw_output = chat.send_message(system_prompt + "\n" + user_prompt,config=generate_content_config).text
                #print(system_prompt + "\n" + user_prompt)
                print(raw_output)
                error_msg = check_output_func(raw_output,**kwargs)
                is_recv_response = True
            except Exception as e:
                if "Connection reset by peer" in str(e):
                    time.sleep(1)
                    print("Caught connection reset error")
                else:
                    raise
        #print(raw_output)
        error_msg = check_output_func(raw_output,**kwargs)
        for trial in range(max_retry-1):
            if error_msg is None:
                break
            else:
                #print(raw_output)
                print(error_msg)
                try:
                    #chat = client.chats.create(model=internal_model)
                    #raw_output = chat.send_message(system_prompt + "\n" + user_prompt,config=generate_content_config).text
                    raw_output = chat.send_message(error_msg,config=generate_content_config).text
                    error_msg = check_output_func(raw_output,**kwargs)
                except Exception as e:
                    if "Connection reset by peer" in str(e):
                        time.sleep(1)
                        print("Caught connection reset error")
                    else:
                        raise
    elif model in ["gpt-4o","gpt-4o-mini","gpt-4.1-mini","gpt-4.1"]:
        local_messages = [{"role":"system","text":system_prompt}, {"role":"user", "text":user_prompt}]
        for trial in range(max_retry):
            raw_output = query_openai(local_messages,schema,model=model)
            #print(raw_output)
            error_msg = check_output_func(raw_output,**kwargs)
            if error_msg is None:
                break
            else:
                print("error msg:",error_msg)
                local_messages.append({"role":"assistant", "text":raw_output})
                local_messages.append({"role":"user", "text":error_msg})
    elif model in ["gemini-2.0-flash", "gemini-2.5-pro-preview-05-06","gemini-2.5-flash","gemini-1.5-flash","gemini-2.0-flash-lite-001","gemini-2.0-flash-001","gemini-2.5-flash-lite-preview-06-17"]:
        if schema is None:
            generate_content_config = genai.types.GenerateContentConfig(
                response_mime_type= "application/json",
            )
        else:
            generate_content_config = genai.types.GenerateContentConfig(
                response_mime_type = "application/json",
                response_schema = schema,
            )
        #client = genai.Client(api_key=open("../../gcloud_api.txt","r").read())
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        chat = client.chats.create(model=model)
        is_recv_response = False
        while not is_recv_response:
            try:
                raw_output = chat.send_message(system_prompt + "\n" + user_prompt,config=generate_content_config).text
                error_msg = check_output_func(raw_output,**kwargs)
                is_recv_response = True
            except Exception as e:
                if "Connection reset by peer" in str(e):
                    time.sleep(1)
                    print("Caught connection reset error")
                else:
                    raise
        #print(raw_output)
        error_msg = check_output_func(raw_output,**kwargs)
        for trial in range(max_retry-1):
            if error_msg is None:
                break
            else:
                #print(raw_output)
                print(error_msg)
                is_recv_response = False
                while not is_recv_response:
                    try:
                        raw_output = chat.send_message(error_msg,config=generate_content_config).text
                        error_msg = check_output_func(raw_output,**kwargs)
                        is_recv_response = True
                    except Exception as e:
                        if "Connection reset by peer" in str(e):
                            time.sleep(1)
                            print("Caught connection reset error")
                        else:
                            raise
    else:
        # Any model name not matched above is routed to Ollama (local inference).
        # This lets callers pass e.g. "qwen2.5:32b" without changing prompt_loop's dispatch logic.
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