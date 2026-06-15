// JS port of nl2structnl.py.
//
// STRUCTNL_MODE selects which format-specific module is used; this JS port only
// implements the "fretish" mode (the only one the Python code actually supported -
// other modes hit `assert False`).

import {
  checkLtlFormula,
  getVariablesFromFormula,
  getLtlFromOutput,
  getAllPossibleDecisionOptionsForEx,
} from './nl2structnl_fretish.js';

export { getNl2structnlTranslation } from './nl2structnl_fretish.js';

// NuSMV-based satisfiability filtering (the "any contain"/"any overlap" filterMode
// branches) was dropped in the JS port - all variable-compatible extrapolated
// outputs are now kept, matching the `filterMode: null` behavior.
export function getExtrapolateOutputs(
  prevOutputs,
  {
    MAX_DURATION = 5,
    getLtlFromOutputFunc = getLtlFromOutput,
    getAllPossibleOptionsFunc = getAllPossibleDecisionOptionsForEx,
  } = {}
) {
  let allOutputs = prevOutputs.slice();
  for (const entry of prevOutputs) {
    allOutputs = allOutputs.concat(getAllPossibleOptionsFunc(entry, MAX_DURATION));
  }
  console.log(allOutputs.length);
  const allLtl = allOutputs.map((entry) => getLtlFromOutputFunc(entry));
  const baseFList = prevOutputs.map((entry) => getLtlFromOutputFunc(entry));

  const overlapIdxList = [];
  const uniqueF = new Set();
  for (let i = 0; i < allLtl.length; i++) {
    const f = allLtl[i];
    if (!uniqueF.has(f) && checkLtlFormula(f)) {
      uniqueF.add(f);
      const fVars = new Set(getVariablesFromFormula(f));
      const isUsingVars = baseFList.some((baseF) => {
        const baseVars = new Set(getVariablesFromFormula(baseF));
        return fVars.size === baseVars.size && [...fVars].every((v) => baseVars.has(v));
      });
      if (isUsingVars) {
        overlapIdxList.push(i);
      }
    }
  }
  return overlapIdxList.map((idx) => allOutputs[idx]);
}
