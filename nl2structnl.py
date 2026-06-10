import json
import llm_prompt
import pandas as pd
from spot_utils import *
try:
    import spot
except ImportError:
    spot = None
from tqdm import tqdm
import itertools
import os

# STRUCTNL_MODE selects which format-specific module to use at runtime.
# Set via os.environ["STRUCTNL_MODE"] = "fretish" in run_llm.ipynb before importing.
# "fretish" loads nl2structnl_fretish (FRETish output with 12-field JSON schema).
# All prompt templates, schema classes, and get_ltl_from_output() come from the selected module.
if os.getenv("STRUCTNL_MODE") == "fretish":
    from nl2structnl_fretish import *
else:
    assert False

def get_extrapolate_outputs(prev_outputs,MAX_DURATION=5,filter_mode="any contain",
                            get_ltl_from_output_func=get_ltl_from_output,
                            get_all_possible_options_func=get_all_possible_decision_options_for_ex,
                            mc_mode="spot"):
    assert filter_mode in ["any contain","any overlap",None]
    all_outputs = prev_outputs.copy()
    for entry in prev_outputs:
        all_outputs += get_all_possible_options_func(entry,MAX_DURATION=MAX_DURATION)
    print(len(all_outputs))
    all_ltl = []
    for entry in all_outputs:
        all_ltl.append(get_ltl_from_output_func(entry))
    #all_ltl = list(set(all_ltl))
    base_f_list = [get_ltl_from_output_func(entry) for entry in prev_outputs]
    if mc_mode == "spot" and filter_mode is not None:
        base_aut_list = [spot.translate(f) for f in base_f_list]
    overlap_idx_list = []
    unique_f = set()
    for i in tqdm(range(len(all_ltl))):
        f = all_ltl[i]
        if f not in unique_f and check_ltl_formula(f):
            unique_f.add(f)
            is_using_vars = any(set(get_variables_from_formula(f)) == (set(get_variables_from_formula(base_f))) for base_f in base_f_list)
            #is_using_vars = any(set(get_variables_from_formula(f)).issubset(set(get_variables_from_formula(base_f))) for base_f in base_f_list)
            if is_using_vars:
                if filter_mode is None:
                    is_pass = True
                else:
                    if mc_mode == "spot":
                        cur_aut = spot.translate(f)
                        if filter_mode == "any contain":
                            is_pass = any(spot.contains(base_aut,cur_aut) for base_aut in base_aut_list) or any(spot.contains(cur_aut,base_aut) for base_aut in base_aut_list)
                        elif filter_mode == "any overlap":
                            is_pass = any(spot.product(cur_aut,base_aut).accepting_run() is not None for base_aut in base_aut_list)
                        else:
                            assert False
                    elif mc_mode == "nusmv":
                        cur_var_dict = dict( (k,"boolean") for k in get_variables_from_formula(f))
                        is_pass = False
                        try:
                            if filter_mode == "any contain":
                                is_pass = any(nusmv_utils.get_nusmv_ltl_satisfiable({**cur_var_dict, **dict((k, "boolean") for k in get_variables_from_formula(base_f))},f"!({base_f}) & ({f})",bmc_k=None,timeout=1) is None \
                                              or nusmv_utils.get_nusmv_ltl_satisfiable({**cur_var_dict, **dict((k, "boolean") for k in get_variables_from_formula(base_f))},f"({base_f}) & !({f})",bmc_k=None,timeout=1) is None \
                                              for base_f in base_f_list)
                            elif filter_mode == "any overlap":
                                is_pass = any(nusmv_utils.get_nusmv_ltl_satisfiable({**cur_var_dict, **dict((k, "boolean") for k in get_variables_from_formula(base_f))},f"({base_f}) & ({f})",bmc_k=None,timeout=1) is not None for base_f in base_f_list)
                            else:
                                assert False
                        except TimeoutError as e:
                            print("caught timeout!")
                            pass
                    else:
                        assert False
                if is_pass:
                    overlap_idx_list.append(i)
    new_output_list = [all_outputs[idx] for idx in overlap_idx_list]
    #new_output_list = [new_output_list[idx] for idx in remove_equivalent_idx([get_ltl_from_output_func(entry) for entry in new_output_list],mc_mode=mc_mode)]
    return new_output_list