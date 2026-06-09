import os
import sys
import json
import pandas as pd

# Set to True to always generate atomic propositions via Ollama (ignores Variables.xlsx).
# Set to False to only generate when Variables.xlsx is not present.
ALWAYS_GENERATE_VARIABLES = False

os.environ["DATA_HOME_DIR"] = "./metadata"
sys.path.insert(0, ".")

import importlib.util
import types
sys.modules["llm_prompt"] = types.ModuleType("llm_prompt")

spec = importlib.util.spec_from_file_location("nl2structnl_fretish", "./nl2structnl_fretish.py")
fretish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fretish)

data_home_dir = "./benchmarks/fret_specs/"
dataset_name = "FSM-S"
row_idx = 0

var_df = pd.read_excel(data_home_dir + dataset_name + "/Variables.xlsx", engine="openpyxl")
ap_dict = {var_df["variable name"][i]: var_df["description"][i] for i in range(len(var_df))}

input_nl = pd.read_excel(data_home_dir + dataset_name + "/PlausibleSpecs.xlsx", engine="openpyxl").iloc[row_idx]["NL"]

print("=== INPUT NL ===")
print(input_nl)
print()

system_prompt, user_prompt = fretish.get_structNL_prompt_simple(input_nl, ap_dict)

print("=== SYSTEM PROMPT ===")
print(system_prompt)
print()
print("=== USER PROMPT ===")
print(user_prompt)