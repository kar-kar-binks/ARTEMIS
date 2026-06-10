import re
import pandas as pd
from nl2structnl import *
import nl2structnl_fretish
import nl2structnl_PSP
import nl2ltl
import itertools
import spot_utils
import openai
from pydantic import BaseModel
from typing import List

print(df_option_names)

def extract_options_for_group(options_per_group,group_idx):
    res = []
    all_cur_options = []
    cur_decision_ids = []
    for decision_id in options_per_group[group_idx]:
        all_cur_options.append(options_per_group[group_idx][decision_id])
        cur_decision_ids.append(decision_id)
    for entry in itertools.product(*all_cur_options):
        res.append(dict( (cur_decision_ids[i],entry[i]) for i in range(len(entry))))
    return res
    
def get_all_option_data(df_row,option_names):
    res = []
    for option_name in option_names:
        try:
            data = json.loads(df_row[option_name])
        except Exception as e:
            print(df_row)
            print(option_name)
            print(df_row[option_name])
            raise e
        res.append(data)
    return res

def postprocess_fretish_outputs_N_DURATION(output_list,max_N_DURATION):
    res = []
    for output in output_list:
        if "N_DURATION" in nl2structnl_fretish.extract_structnl_from_output(output) and output["N_DURATION"] is None:
            for N_DURATION in range(1,max_N_DURATION+1):
                new_output = output.copy()
                new_output["N_DURATION"] = N_DURATION
                res.append(new_output)
        else:
            res.append(output)
    return res

def get_all_outputs_from_options_per_group(all_options_per_group):
    #all_options_per_group = option type X group X decisions
    res = []
    num_groups = len(all_options_per_group[0])
    for group_idx in range(num_groups):
        cur_group_options = []
        for options_per_group in all_options_per_group:
            cur_group_options.append(extract_options_for_group(options_per_group,group_idx))
        cur_group_outputs = []
        for entry in itertools.product(*cur_group_options):
            output_dict = {}
            for part_dict in entry:
                output_dict.update(part_dict)
            cur_group_outputs.append(output_dict)
        res += cur_group_outputs
    return res

def get_all_outputs_for_df_row(df_row,max_N_DURATION=5,group_by_template=False,structnl="fretish"):
    if structnl == "fretish":
        decision_to_item_list = nl2structnl_fretish.decision_to_item_list
        df_option_names = nl2structnl_fretish.df_option_names
    elif structnl == "PSP":
        decision_to_item_list = nl2structnl_PSP.decision_to_item_list
        df_option_names = nl2structnl_PSP.df_option_names
    else:
        assert False
    #global decision_to_item_list
    #global df_option_names

    all_options_per_group = get_all_option_data(df_row,df_option_names)
    #all_options_per_group = option type X group X decisions
    
    output_list = get_all_outputs_from_options_per_group(all_options_per_group)
    if structnl == "fretish" and max_N_DURATION is not None:
        if not group_by_template:
            res = postprocess_fretish_outputs_N_DURATION(output_list,max_N_DURATION=max_N_DURATION)
        else:
            res = []
            for output in output_list:
                res.append(postprocess_fretish_outputs_N_DURATION([output],max_N_DURATION=max_N_DURATION))
    else:
        res = output_list
    
    for output in res:
        for decision,item_list in decision_to_item_list.items():
            for item in item_list:
                if item not in output:
                    output[item] = None
    return res

# Builds a {variable_name: description} dict from a Variables.xlsx sheet.
# This dict is the "atomic propositions glossary" injected into the LLM prompt.
def get_ap_dict(var_df):
    ap_dict = {}
    var_names = var_df["variable name"]
    var_descriptions = var_df["description"]
    for i in range(len(var_df)):
        ap_dict[var_names[i]] = var_descriptions[i]
    return ap_dict

def load_outputs(result_dir,cur_dataset_name,row_idx,model,num_trial,cur_method,cur_mode,max_N_DURATION=None,structnl="fretish"):
    cur_exp_name = f"{result_dir}/{cur_dataset_name}-{row_idx}_model-{model}_trials-{num_trial}"
    
    with open(cur_exp_name + "_" + cur_method +".json", "r") as json_file:
        cur_outputs = json.load(json_file)

    if structnl == "fretish":
        get_ltl_from_output = nl2structnl_fretish.get_ltl_from_output
        get_all_possible_decision_options_for_ex = nl2structnl_fretish.get_all_possible_decision_options_for_ex
    elif structnl == "PSP":
        get_ltl_from_output = nl2structnl_PSP.get_ltl_from_output
        get_all_possible_decision_options_for_ex = nl2structnl_PSP.get_all_possible_decision_options_for_ex
    else:
        assert False
    
    if cur_method in ["nl2ltltemplate","nl2ltl","nl2spec","NL2TL","deepstl","synthtl","NL2TL-FT"]:
        get_ltl_from_output_func = lambda x : x["output_LTL"]
        get_all_possible_options_func = nl2ltl.get_all_possible_ltltemplates_for_ex
    elif cur_method in ["nl2structnl-reflect","nl2structnl","nl2structnl_dcmp"]:
        get_ltl_from_output_func = get_ltl_from_output
        get_all_possible_options_func = get_all_possible_decision_options_for_ex
    else:
        assert False
    cur_outputs= [output for output in cur_outputs if spot_utils.check_ltl_formula(get_ltl_from_output_func(output))]
    
    if cur_mode == "extra":
        cur_outputs = get_extrapolate_outputs(cur_outputs,
                                                             MAX_DURATION=max_N_DURATION,
                                                             #filter_mode="any contain",
                                                             filter_mode=None,
                                                             get_ltl_from_output_func=get_ltl_from_output_func,
                                                             get_all_possible_options_func=get_all_possible_options_func,
                                                             #mc_mode="nusmv"
                                                            )
    if cur_method in ["nl2structnl-reflect","nl2structnl","nl2structnl_dcmp"]:
        output_ltl_list = [get_ltl_from_output(entry) for entry in cur_outputs]
    elif cur_method in ["nl2ltltemplate","nl2ltl","nl2spec","NL2TL","deepstl","synthtl","NL2TL-FT"]:
        output_ltl_list = [spot_utils.filter_ltl_formula(entry["output_LTL"]) for entry in cur_outputs]
    else:
        assert False
    return cur_outputs, output_ltl_list

def load_labels(data_home_dir,cur_dataset_name,row_idx,max_N_DURATION=None,cur_df_file=None,structnl="fretish"):
    if cur_df_file is None:
        cur_df_file = data_home_dir + cur_dataset_name + "/PlausibleSpecs.xlsx"
    df = pd.read_excel(cur_df_file, engine='openpyxl')
    label_output_list = get_all_outputs_for_df_row(df.iloc[row_idx],max_N_DURATION=max_N_DURATION,structnl=structnl)
    if structnl == "fretish":
        label_ltl_list = [nl2structnl_fretish.get_ltl_from_output(output) for output in label_output_list]
    elif structnl == "PSP":
        label_ltl_list = [nl2structnl_PSP.get_ltl_from_output(output) for output in label_output_list]
    else:
        assert False
    return label_output_list, label_ltl_list

class _AP(BaseModel):
    variable_name: str
    description: str

class _APList(BaseModel):
    atomic_propositions: List[_AP]

# Identifiers must follow the FRET grammar's ID rule: start with a letter,
# followed by letters, digits, or underscores (e.g. "limits", "state_is_NOMINAL").
_AP_ID_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')

# Words reserved by the FRET requirements grammar (matched case-insensitively,
# since the grammar's keyword fragments are case-insensitive) and therefore
# unusable as variable names.
_FRET_RESERVED_WORDS = {
    "after", "always", "and", "at", "before", "during", "eventually", "except",
    "false", "finally", "first", "for", "hour", "hours", "if", "immediately",
    "in", "initially", "is", "last", "microsecond", "microseconds",
    "millisecond", "milliseconds", "minute", "minutes", "mod", "mode",
    "never", "next", "not", "occurrence", "of", "only", "or", "previous",
    "probability", "same", "satisfy", "second", "seconds", "shall", "the",
    "then", "tick", "ticks", "timepoint", "true", "unless", "until", "upon",
    "what", "when", "whenever", "where", "while", "with", "within", "xor",
}

def _check_ap_output(raw):
    """Validate raw JSON from Ollama for AP generation. Returns error string or None."""
    try:
        parsed = _APList(**json.loads(raw))
    except Exception as e:
        return f"Invalid format: {e}"
    if len(parsed.atomic_propositions) == 0:
        return "No atomic propositions were generated. Please generate at least one."
    bad = [ap.variable_name for ap in parsed.atomic_propositions
           if not _AP_ID_RE.match(ap.variable_name)]
    if bad:
        return (f"The following variable names are not valid identifiers: {bad}. "
                f"Variable names must start with a letter and contain only letters, "
                f"digits, and underscores (e.g. 'limits', 'state_is_NOMINAL').")
    reserved = [ap.variable_name for ap in parsed.atomic_propositions
                if ap.variable_name.lower() in _FRET_RESERVED_WORDS]
    if reserved:
        return (f"The following variable names are reserved words in the FRET "
                f"requirements grammar and cannot be used: {reserved}. "
                f"Please choose different variable names.")
    return None

def generate_ap_dict_via_ollama(data_home_dir, cur_dataset_name, model="qwen2.5:32b", max_retry=3):
    """Query Ollama to generate atomic propositions (variable name + description) for a dataset."""
    cur_df_file = data_home_dir + cur_dataset_name + "/PlausibleSpecs.xlsx"
    df = pd.read_excel(cur_df_file, engine='openpyxl')
    nl_requirements = df["NL"].dropna().tolist()

    _ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    _ollama_client = openai.OpenAI(base_url=_ollama_base_url, api_key="ollama")

    system_prompt = (
        "You are an expert in requirements engineering and formal specification. "
        "Given a list of natural language requirements, identify all atomic boolean propositions "
        "(system state variables) needed to express them formally as FRETish requirements. "
        "For each proposition provide a variable name and a brief description. "
        "Variable names must be valid identifiers in the FRET requirements grammar: they must "
        "start with a letter and contain only letters, digits, and underscores (no spaces, "
        "hyphens, or other special characters), and must not be one of FRET's reserved words "
        "(e.g. shall, when, if, mode, and, or, not, true, false, until, within). "
        "Use lowercase snake_case names for ordinary variables (e.g. \"sensor_is_active\"). "
        "For a variable that represents a finite-state-machine being in a particular mode, "
        "use the pattern \"state_is_<MODE_NAME>\" with the mode name in upper case "
        "(e.g. \"state_is_NOMINAL\", \"state_is_FAULT\"). "
        "Respond with a single JSON object only, with no extra text, commentary, or markdown "
        "code fences, in exactly this format:\n"
        '{"atomic_propositions": [{"variable_name": "sensor_is_active", '
        '"description": "True when the sensor is active"}, {"variable_name": "state_is_NOMINAL", '
        '"description": "True when the system is in the NOMINAL state"}]}'
    )
    user_prompt = (
        "Generate atomic propositions for the following requirements:\n"
        + json.dumps(nl_requirements, indent=2)
    )

    messages = [
        {"role": "system", "content": [{"type": "text", "text": system_prompt}]},
        {"role": "user", "content": [{"type": "text", "text": user_prompt}]},
    ]
    raw = None
    for trial in range(max_retry):
        response = _ollama_client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        if not raw:
            print(f"AP generation: empty response from Ollama (trial {trial+1}). "
                  f"finish_reason={response.choices[0].finish_reason!r}, "
                  f"message={response.choices[0].message!r}")
        error_msg = _check_ap_output(raw)
        if error_msg is None:
            break
        print(f"AP generation error (trial {trial+1}): {error_msg}")
        messages.append({"role": "assistant", "content": [{"type": "text", "text": raw}]})
        messages.append({"role": "user", "content": [{"type": "text", "text": error_msg}]})

    parsed = _APList(**json.loads(raw))
    return {ap.variable_name: ap.description for ap in parsed.atomic_propositions}

# Loads the atomic propositions glossary for a dataset.
# If Variables.xlsx exists (and always_generate is False), builds {name: description} from it.
# If always_generate is True, or Variables.xlsx is absent, queries Ollama to generate propositions.
# Falls back to ap_dict column in PlausibleSpecs.xlsx if Ollama generation is not requested.
def load_vars(data_home_dir, cur_dataset_name, row_idx=None, always_generate=False, model="qwen2.5:32b"):
    cur_var_file = data_home_dir + cur_dataset_name + "/Variables.xlsx"
    if os.path.exists(cur_var_file) and not always_generate:
        var_df = pd.read_excel(cur_var_file, engine='openpyxl')
        return get_ap_dict(var_df)
    if always_generate or not os.path.exists(cur_var_file):
        print(f"Generating atomic propositions via Ollama for {cur_dataset_name}...")
        return generate_ap_dict_via_ollama(data_home_dir, cur_dataset_name, model=model)
    cur_var_file = data_home_dir + cur_dataset_name + "/PlausibleSpecs.xlsx"
    if os.path.exists(cur_var_file):
        df = pd.read_excel(cur_var_file, engine='openpyxl')
        return json.loads(df.iloc[row_idx]["ap_dict"])
    assert False, "cannot load ap_dict!"