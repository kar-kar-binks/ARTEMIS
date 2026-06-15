// JS port of spot_utils.py.
//
// Spot (the C++/Python LTL & omega-automata library) has no JS equivalent, so all
// Spot-only functions below are stubbed and throw. The pure-JS helpers (used by
// nl2structnl_fretish.js and elsewhere) work the same as the Python fallbacks that
// were already used when Spot was unavailable.

// ---------------------------------------------------------------------------
// Pure-JS helpers (no Spot required)
// ---------------------------------------------------------------------------

const _TOKEN_RE = /<->|->|[!&|()[\]]|[A-Za-z_][A-Za-z0-9_]*|\d+/g;
const _BOOL_OPS = new Set(['!', '&', '|', '->', '<->']);
const _LTL_OPS = new Set(['F', 'G', 'X', 'U', 'R', 'W', 'M']);
const _CONSTANTS = new Set(['true', 'false', 'TRUE', 'FALSE', '1', '0']);

function _balancedParens(s) {
  let depth = 0;
  for (const c of s) {
    if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function _findTokens(s) {
  return [...s.matchAll(_TOKEN_RE)].map((m) => m[0]);
}

export function checkBooleanFormula(fStr, retErrMsg = false) {
  if (!fStr) {
    return retErrMsg ? 'boolean expression is empty or None' : false;
  }
  if (!_balancedParens(fStr)) {
    return retErrMsg ? 'unbalanced parentheses' : false;
  }
  for (const tok of _findTokens(fStr)) {
    if (_LTL_OPS.has(tok)) {
      const msg = `formula contains LTL/temporal operator '${tok}'`;
      return retErrMsg ? msg : false;
    }
  }
  return retErrMsg ? '' : true;
}

export function getVariablesFromFormula(formulaStr) {
  if (!formulaStr) {
    return [];
  }
  const nonVars = new Set([..._BOOL_OPS, ..._LTL_OPS, ..._CONSTANTS, '(', ')']);
  const seen = new Set();
  const result = [];
  for (const tok of _findTokens(formulaStr)) {
    if (!nonVars.has(tok) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
      if (!seen.has(tok)) {
        seen.add(tok);
        result.push(tok);
      }
    }
  }
  return result;
}

export function checkLtlFormula(fStr, retErrMsg = false) {
  if (!fStr) {
    return retErrMsg ? 'formula is empty or None' : false;
  }
  if (!_balancedParens(fStr)) {
    return retErrMsg ? 'unbalanced parentheses' : false;
  }
  return retErrMsg ? '' : true;
}

// Wrap a formula string in parens (replaces spot.formula(f).to_str(parenth=True)).
export function parenthesize(fStr) {
  if (!fStr) {
    return fStr;
  }
  return `(${fStr})`;
}

// ---------------------------------------------------------------------------
// Functions that required Spot (model-checking, automaton ops)
// ---------------------------------------------------------------------------

// Pure-JS fallback only (no Spot available in the JS port).
export function filterLtlFormula(fStr) {
  fStr = fStr.trim();
  // Normalize standalone boolean constants for NuSMV
  fStr = fStr.replace(/\bTRUE\b/g, 'TRUE');
  fStr = fStr.replace(/\bFALSE\b/g, 'FALSE');
  fStr = fStr.replace(/(?<![A-Za-z0-9_])1(?![A-Za-z0-9_])/g, 'TRUE');
  fStr = fStr.replace(/(?<![A-Za-z0-9_])0(?![A-Za-z0-9_])/g, 'FALSE');
  // Wrap in outer parens for canonical form (idempotent since we always wrap)
  fStr = `(${fStr})`;
  return fStr;
}

export function checkNontrivialBooleanFormula(_fStr) {
  throw new Error('checkNontrivialBooleanFormula: Spot support was dropped in the JS port');
}

export function checkValidNonnegativeInteger(fStr) {
  const val = Number(fStr);
  return Number.isInteger(val) && val > 0;
}

export function checkSatisfiable(_formulaStr) {
  throw new Error('checkSatisfiable: Spot support was dropped in the JS port');
}

export function constructStr(_propList) {
  throw new Error('constructStr: Spot support was dropped in the JS port');
}

export function getTracePrefixList(_automaton, _accRun) {
  throw new Error('getTracePrefixList: Spot support was dropped in the JS port');
}

export function getTraceCycleList(_automaton, _accRun) {
  throw new Error('getTraceCycleList: Spot support was dropped in the JS port');
}

export function getStepwiseFormulaLists(_trace) {
  throw new Error('getStepwiseFormulaLists: Spot support was dropped in the JS port');
}

export function traceToFormula(_trace, _debug = true) {
  throw new Error('traceToFormula: Spot support was dropped in the JS port');
}
