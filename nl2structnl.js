// JS port of nl2structnl.py.
//
// STRUCTNL_MODE selects which format-specific module is used; this JS port only
// implements the "fretish" mode (the only one the Python code actually supported -
// other modes hit `assert False`).

import { checkLtlFormula, getVariablesFromFormula } from './spot_utils.js';
import * as nusmvUtils from './nusmv_utils.js';
import {
  getLtlFromOutput,
  getAllPossibleDecisionOptionsForEx,
} from './nl2structnl_fretish.js';

export { getNl2structnlTranslation } from './nl2structnl_fretish.js';

// `mc_mode` defaults to "nusmv" here (was "spot" in Python). The "spot" mode has been
// dropped per the JS-port decision to drop Spot support; the "nusmv" branch (which
// already existed in the Python source) is used instead.
export function getExtrapolateOutputs(
  prevOutputs,
  {
    MAX_DURATION = 5,
    filterMode = 'any contain',
    getLtlFromOutputFunc = getLtlFromOutput,
    getAllPossibleOptionsFunc = getAllPossibleDecisionOptionsForEx,
    mcMode = 'nusmv',
  } = {}
) {
  if (!['any contain', 'any overlap', null].includes(filterMode)) {
    throw new Error('invalid filterMode');
  }
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
        let isPass;
        if (filterMode === null) {
          isPass = true;
        } else if (mcMode === 'nusmv') {
          const curVarDict = {};
          for (const v of getVariablesFromFormula(f)) curVarDict[v] = 'boolean';
          isPass = false;
          try {
            if (filterMode === 'any contain') {
              isPass = baseFList.some((baseF) => {
                const varDict = { ...curVarDict };
                for (const v of getVariablesFromFormula(baseF)) varDict[v] = 'boolean';
                return (
                  nusmvUtils.getNusmvLtlSatisfiable(varDict, `!(${baseF}) & (${f})`, null, false, 1) === null ||
                  nusmvUtils.getNusmvLtlSatisfiable(varDict, `(${baseF}) & !(${f})`, null, false, 1) === null
                );
              });
            } else if (filterMode === 'any overlap') {
              isPass = baseFList.some((baseF) => {
                const varDict = { ...curVarDict };
                for (const v of getVariablesFromFormula(baseF)) varDict[v] = 'boolean';
                return nusmvUtils.getNusmvLtlSatisfiable(varDict, `(${baseF}) & (${f})`, null, false, 1) !== null;
              });
            } else {
              throw new Error('invalid filterMode');
            }
          } catch (e) {
            if (e instanceof nusmvUtils.TimeoutError) {
              console.log('caught timeout!');
            } else {
              throw e;
            }
          }
        } else {
          throw new Error(`mc_mode '${mcMode}' not supported: Spot support was dropped in the JS port`);
        }
        if (isPass) {
          overlapIdxList.push(i);
        }
      }
    }
  }
  return overlapIdxList.map((idx) => allOutputs[idx]);
}
