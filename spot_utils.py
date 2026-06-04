import re

try:
    import spot as _spot
    _SPOT_AVAILABLE = True
except ImportError:
    _spot = None
    _SPOT_AVAILABLE = False

# ---------------------------------------------------------------------------
# Pure-Python helpers (used when spot is unavailable)
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r'<->|->|[!&|()\[\]]|[A-Za-z_][A-Za-z0-9_]*|\d+')
_BOOL_OPS  = {'!', '&', '|', '->', '<->'}
_LTL_OPS   = {'F', 'G', 'X', 'U', 'R', 'W', 'M'}
_CONSTANTS = {'true', 'false', 'TRUE', 'FALSE', '1', '0'}


def _balanced_parens(s):
    depth = 0
    for c in s:
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def check_boolean_formula(f_str, ret_err_msg=False):
    if not f_str:
        return "boolean expression is empty or None" if ret_err_msg else False
    if not _balanced_parens(f_str):
        return "unbalanced parentheses" if ret_err_msg else False
    for tok in _TOKEN_RE.findall(f_str):
        if tok in _LTL_OPS:
            msg = f"formula contains LTL/temporal operator '{tok}'"
            return msg if ret_err_msg else False
    return "" if ret_err_msg else True


def get_variables_from_formula(formula_str):
    if not formula_str:
        return []
    non_vars = _BOOL_OPS | _LTL_OPS | _CONSTANTS | {'(', ')'}
    seen, result = set(), []
    for tok in _TOKEN_RE.findall(formula_str):
        if tok not in non_vars and re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', tok):
            if tok not in seen:
                seen.add(tok)
                result.append(tok)
    return result


def check_ltl_formula(f_str, ret_err_msg=False):
    if not f_str:
        return "formula is empty or None" if ret_err_msg else False
    if not _balanced_parens(f_str):
        return "unbalanced parentheses" if ret_err_msg else False
    return "" if ret_err_msg else True


def parenthesize(f_str):
    """Wrap a formula string in parens (replaces spot.formula(f).to_str(parenth=True))."""
    if not f_str:
        return f_str
    return f"({f_str})"


# ---------------------------------------------------------------------------
# Functions that require spot (model-checking, automaton ops)
# ---------------------------------------------------------------------------

def filter_ltl_formula(f_str):
    if _SPOT_AVAILABLE and hasattr(_spot, 'unabbreviate'):
        spot_f = _spot.formula(f_str)
        spot_f = _spot.unabbreviate(spot_f, "RW")
        new_f_str = spot_f.to_str(parenth=True)
        if new_f_str == "1":
            return "TRUE"
        elif new_f_str == "0":
            return "FALSE"
        else:
            return new_f_str.replace("(0)","(FALSE)").replace("(1)","(TRUE)").replace("(1 ","(TRUE ")
    # Pure-Python fallback (no spot or spot missing unabbreviate)
    f_str = f_str.strip()
    # Normalize standalone boolean constants for NuSMV
    f_str = re.sub(r'\bTRUE\b', 'TRUE', f_str)
    f_str = re.sub(r'\bFALSE\b', 'FALSE', f_str)
    f_str = re.sub(r'(?<![A-Za-z0-9_])1(?![A-Za-z0-9_])', 'TRUE', f_str)
    f_str = re.sub(r'(?<![A-Za-z0-9_])0(?![A-Za-z0-9_])', 'FALSE', f_str)
    # Wrap in outer parens for canonical form (idempotent since we always wrap)
    f_str = f'({f_str})'
    return f_str

def check_nontrivial_boolean_formula(f_str):
    return not _spot.are_equivalent(f_str,"1") and not _spot.are_equivalent(f_str,"0")

def check_valid_nonnegative_integer(f_str):
    try:
        val = int(f_str)
        return val > 0
    except:
        return False

def check_satisfiable(formula_str):
    spot_formula = _spot.formula(formula_str)
    automaton = spot_formula.translate()
    automaton.merge_edges()
    trace_word = automaton.accepting_word()
    if trace_word is not None:
        return trace_word.as_automaton()
    else:
        return None

def construct_str(prop_list):
    if len(prop_list) == 0:
        return "1"
    res_str = "(" + prop_list[0] + ") "
    for i in range(1, len(prop_list)):
        res_str += "& " + i*"X" + "(" + prop_list[i] + ") "
    return "(" + res_str + ")"

def get_trace_prefix_list(automaton, acc_run):
    return [_spot.bdd_format_formula(automaton.get_dict(), acc_run.prefix[i])
            for i in range(len(acc_run.prefix))]

def get_trace_cycle_list(automaton, acc_run):
    return [_spot.bdd_format_formula(automaton.get_dict(), acc_run.cycle[i])
            for i in range(len(acc_run.cycle))]

def get_stepwise_formula_lists(trace):
    automaton = trace.as_automaton()
    acc_run = automaton.accepting_word()
    return get_trace_prefix_list(automaton, acc_run), get_trace_cycle_list(automaton, acc_run)

def trace_to_formula(trace, debug=True):
    acc_run = trace.accepting_word()
    prefix_list = get_trace_prefix_list(trace, acc_run)
    cycle_list  = get_trace_cycle_list(trace, acc_run)
    prefix_str  = construct_str(prefix_list)
    cycle_str   = construct_str(cycle_list)
    cycle_condition_str = "G(" + cycle_str + " <-> " + len(cycle_list)*"X" + cycle_str + ")"
    full_form = (prefix_str + " & " + len(prefix_list)*"X" + cycle_str
                 + " & " + len(prefix_list)*"X" + cycle_condition_str)
    full_form = _spot.formula(full_form).to_str(parenth=True)
    if debug:
        assert _spot.are_equivalent(_spot.formula(full_form), trace)
    return full_form
