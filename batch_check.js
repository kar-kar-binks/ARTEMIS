// JS port of batch_check.py.
//
// Spot-only functions (`subprocess_batch_spot_MC`, `determine_timeout_idx`,
// `get_aut_product`, `get_most_constrained_idx`, `get_least_constrained_idx`) have no
// NuSMV equivalent and are stubbed/throw, per the JS-port decision to drop Spot
// support. The NuSMV-based dispatch/equivalence-removal paths (which already existed
// in the Python source) are ported in full and are now the only path:
// `dispatch_batch_MC`/`parallel_dispatch_batch_MC` default to `spot_timeout=0` (always
// NuSMV), and `remove_equivalent_idx` only implements `mc_mode="nusmv"`.
// `remove_equivalent_idx_old` (dead code, unreferenced) was dropped.

import { writeFileSync } from 'fs';
import * as spotUtils from './spot_utils.js';
import * as nusmvUtils from './nusmv_utils.js';

const DATA_HOME_DIR = process.env.DATA_HOME_DIR;
const SMV_FILE_DIR = process.env.SMV_FILE_DIR;

export async function runInParallelPreserveOrder(jobs, _maxWorkers = 4) {
  const results = await Promise.allSettled(jobs.map(([func, args]) => Promise.resolve(func(...args))));
  return results.map((r) => (r.status === 'fulfilled' ? r.value : 'Timeout exceeded'));
}

export function parseNusmvBatchResults(rawOut, checkFList, _bmcK) {
  const falsePattern = /^-- specification\s+(.*?)\s+is false/gm;
  const falseFormulas = [...rawOut.matchAll(falsePattern)]
    .map((m) => m[1])
    .map((entry) => spotUtils.filterLtlFormula(entry));
  const truePattern = /^-- specification\s+(.*?)\s+is true/gm;
  const trueFormulas = [...rawOut.matchAll(truePattern)]
    .map((m) => m[1])
    .map((entry) => spotUtils.filterLtlFormula(entry));

  const res = [];
  for (let i = 0; i < checkFList.length; i++) {
    const formula = checkFList[i];
    const curF = spotUtils.filterLtlFormula(formula);
    if (_bmcK == null && !trueFormulas.includes(curF) && !falseFormulas.includes(curF)) {
      if (!(checkFList.length > trueFormulas.length + falseFormulas.length)) {
        throw new Error('assertion failed: checkFList.length > trueFormulas.length + falseFormulas.length');
      }
      res.push(null);
    } else {
      res.push(!falseFormulas.includes(curF));
    }
  }
  return res;
}

export function nusmvBatchJob(totalVarDict, checkFList, smvFname, { timeout = null, bmcK = null } = {}) {
  let totalStr = 'MODULE main\n';
  totalStr += 'VAR\n';
  for (const [varName, varType] of Object.entries(totalVarDict)) {
    totalStr += varName + ' : ' + varType + ';\n';
  }
  totalStr += 'JUSTICE TRUE;\n';
  for (const formula of checkFList) {
    totalStr += 'LTLSPEC\n';
    totalStr += `${formula}\n\n`;
  }
  // Write the combined multi-LTLSPEC batch file directly (nusmv_formula_to_file only
  // supports a single LTLSPEC).
  writeFileSync(smvFname, totalStr);
  const [rawOut, rawErr] = nusmvUtils.callNusmv(smvFname, bmcK, timeout);
  const res = parseNusmvBatchResults(rawOut, checkFList, bmcK);
  if (timeout === null) {
    if (res.some((entry) => entry === null)) {
      console.log(rawOut, '\n', rawErr);
      throw new Error('assertion failed: not any(entry is None for entry in res)');
    }
  }
  return res;
}

export function subprocessBatchNusmvMC(allJobs, smvFname, { bmcK = null, timeout = null } = {}) {
  const [totalVarDict, checkFList] = toSmvBatchJobList(allJobs);
  const results = nusmvBatchJob(totalVarDict, checkFList, smvFname, { timeout, bmcK });
  for (let i = 0; i < allJobs.length; i++) {
    if (allJobs[i][0] === 'overlap' && results[i] !== null) {
      results[i] = !results[i];
    }
  }
  return results;
}

// Spot-only: dropped. `dispatch_batch_MC` is called with `spot_timeout=0` by default
// in this JS port, so this is unreachable in normal use.
export function subprocessBatchSpotMC(_jobList, _jobFname = 'tmp_spot.json', _timeout = null) {
  throw new Error('subprocessBatchSpotMC: Spot support was dropped in the JS port');
}

export function toSmvBatchJobList(jobList) {
  const totalVarDict = {};
  const resList = [];
  for (const [checkType, formulas] of jobList) {
    let f1, f2, f;
    if (formulas.length === 2) {
      [f1, f2] = formulas;
      for (const k of spotUtils.getVariablesFromFormula(f1)) totalVarDict[k] = 'boolean';
      for (const k of spotUtils.getVariablesFromFormula(f2)) totalVarDict[k] = 'boolean';
    } else if (formulas.length === 1) {
      [f] = formulas;
      for (const k of spotUtils.getVariablesFromFormula(f)) totalVarDict[k] = 'boolean';
    } else {
      throw new Error('toSmvBatchJobList: formulas must have length 1 or 2');
    }
    if (checkType === 'equivalence') {
      resList.push(`(${f1}) <-> (${f2})`);
    } else if (checkType === 'subset') {
      resList.push(`!((${f1}) & !(${f2}))`);
    } else if (checkType === 'superset') {
      resList.push(`!(!(${f1}) & (${f2}))`);
    } else if (checkType === 'overlap') {
      resList.push(`!((${f1}) & (${f2}))`);
    } else if (checkType === 'satisfiable') {
      throw new Error('unimplemented');
    } else {
      throw new Error('check type not found!');
    }
  }
  for (let i = 0; i < resList.length; i++) {
    resList[i] = spotUtils.filterLtlFormula(resList[i]);
  }
  return [totalVarDict, resList];
}

// Spot-only: dropped (no NuSMV equivalent exists for these helpers).
export function getMostConstrainedIdx(_ltlList) {
  throw new Error('getMostConstrainedIdx: Spot support was dropped in the JS port');
}

export function getLeastConstrainedIdx(_ltlList) {
  throw new Error('getLeastConstrainedIdx: Spot support was dropped in the JS port');
}

// Spot-only: dropped (no NuSMV equivalent exists; only reachable via the
// Spot-only "timeout"/"spot" modes of remove_equivalent_idx, which were removed).
export function determineTimeoutIdx(_ltlList) {
  throw new Error('determineTimeoutIdx: Spot support was dropped in the JS port');
}

// Spot-only: dropped (used only by the Spot-only modes above).
export function getAutProduct(_fList, _bmcK = null) {
  throw new Error('getAutProduct: Spot support was dropped in the JS port');
}

// `dispatch_batch_MC` / `parallel_dispatch_batch_MC`: the `spot_timeout > 0` /
// `subprocess_batch_spot_MC` branch has been removed. Default `spotTimeout` is 0,
// so these always use the NuSMV path (behaviorally equivalent to calling the Python
// version with `spot_timeout=0`).
export function dispatchBatchMC(allJobs, { spotTimeout = 0, nusmvTimeout = null, nusmvJobsPerThread = 1, bmcK = null, threadId = 0 } = {}) {
  if (spotTimeout > 0) {
    throw new Error('dispatchBatchMC: spotTimeout > 0 requires Spot, which was dropped in the JS port');
  }
  let results = [];
  const numChunks = Math.floor(allJobs.length / nusmvJobsPerThread) + (allJobs.length % nusmvJobsPerThread);
  for (let i = 0; i < numChunks; i++) {
    const chunk = allJobs.slice(i * nusmvJobsPerThread, i * nusmvJobsPerThread + nusmvJobsPerThread);
    if (chunk.length === 0) continue;
    try {
      const curResults = subprocessBatchNusmvMC(chunk, `${SMV_FILE_DIR}/tmp${threadId}.smv`, {
        timeout: nusmvTimeout,
        bmcK,
      });
      results = results.concat(curResults);
    } catch (e) {
      if (e instanceof nusmvUtils.TimeoutError) {
        results = results.concat(chunk.map(() => null));
      } else {
        throw e;
      }
    }
  }
  return results;
}

export async function parallelDispatchBatchMC(allJobs, { jobsPerThread = null, spotTimeout = 0, nusmvTimeout = null, nusmvJobsPerThread = 1, bmcK = null } = {}) {
  if (jobsPerThread === null) {
    jobsPerThread = nusmvJobsPerThread;
  }
  const jobAllocation = [];
  const numChunks = Math.floor(allJobs.length / jobsPerThread) + (allJobs.length % jobsPerThread);
  for (let i = 0; i < numChunks; i++) {
    const curJobs = allJobs.slice(i * jobsPerThread, i * jobsPerThread + jobsPerThread);
    if (curJobs.length === 0) continue;
    jobAllocation.push([
      dispatchBatchMC,
      [curJobs, { spotTimeout, nusmvTimeout, nusmvJobsPerThread, bmcK, threadId: i }],
    ]);
  }
  const resultsPerJob = await runInParallelPreserveOrder(jobAllocation, 10);
  let results = [];
  for (let i = 0; i < resultsPerJob.length; i++) {
    if (resultsPerJob[i] === 'Timeout exceeded') {
      throw new Error('assertion failed: results_per_job[i] != "Timeout exceeded"');
    }
    results = results.concat(resultsPerJob[i]);
  }
  return results;
}

// `remove_equivalent_idx`: only `mc_mode === "nusmv"` is implemented (the "spot" and
// "timeout" modes depended on Spot/determine_timeout_idx, both dropped). With
// `mc_mode === "nusmv"`, `timeout_idx` is always empty, so the Spot-timeout branches
// of the original algorithm are unreachable and have been removed.
export function removeEquivalentIdx(ltlList, { mcMode = 'nusmv', retEquivDict = false, bmcK = null, constraintFList = null } = {}) {
  if (mcMode !== 'nusmv') {
    throw new Error(`removeEquivalentIdx: mc_mode '${mcMode}' not supported: Spot support was dropped in the JS port`);
  }
  let objList;
  if (constraintFList !== null && constraintFList.length > 0) {
    const constraintStr = constraintFList.join(') & (');
    objList = ltlList.map((entry) => `(${constraintStr}) & (${entry})`);
  } else {
    objList = ltlList;
  }

  const checkEquivFunc = (i, j) => {
    const curVarDict = {};
    for (const v of spotUtils.getVariablesFromFormula(objList[i])) curVarDict[v] = 'boolean';
    for (const v of spotUtils.getVariablesFromFormula(objList[j])) curVarDict[v] = 'boolean';
    return nusmvUtils.getNusmvLtlEquivalent(curVarDict, objList[i], curVarDict, objList[j], bmcK);
  };
  const getTrace = (i) => {
    const curVarDict = {};
    for (const v of spotUtils.getVariablesFromFormula(objList[i])) curVarDict[v] = 'boolean';
    return String(nusmvUtils.getNusmvLtlSatisfiable(curVarDict, objList[i], 10));
  };

  const wordDict = new Map();
  for (let i = 0; i < ltlList.length; i++) {
    const curHash = getTrace(i);
    if (!wordDict.has(curHash)) {
      wordDict.set(curHash, []);
    }
    wordDict.get(curHash).push(i);
  }

  const equivDict = new Map();
  const visited = new Set();
  for (const idxList of wordDict.values()) {
    for (let curIndex = 0; curIndex < idxList.length; curIndex++) {
      const i = idxList[curIndex];
      if (!visited.has(i)) {
        for (const j of idxList.slice(curIndex + 1)) {
          if (checkEquivFunc(i, j)) {
            if (!equivDict.has(i)) equivDict.set(i, []);
            if (equivDict.has(j)) {
              equivDict.get(i).push(...equivDict.get(j));
              equivDict.delete(j);
            }
            equivDict.get(i).push(j);
            visited.add(j);
          }
        }
      }
    }
  }

  const itemsToDelete = new Set();
  for (const val of equivDict.values()) {
    for (const e of val) itemsToDelete.add(e);
  }
  for (const key of equivDict.keys()) {
    for (const val of equivDict.values()) {
      if (val.includes(key)) {
        throw new Error('assertion failed: key not in val');
      }
    }
  }

  const checkedSet = new Set();
  for (const idxList of wordDict.values()) {
    for (const a of idxList) {
      for (const b of idxList) {
        checkedSet.add(`${a},${b}`);
      }
    }
  }
  let newIdxList = [];
  for (let idx = 0; idx < ltlList.length; idx++) {
    if (!itemsToDelete.has(idx)) newIdxList.push(idx);
  }

  for (let curIndex = 0; curIndex < newIdxList.length; curIndex++) {
    const i = newIdxList[curIndex];
    if (!visited.has(i)) {
      const curIdxList = newIdxList.slice(curIndex + 1).filter((entry) => !checkedSet.has(`${i},${entry}`));
      for (const j of curIdxList) {
        if (checkEquivFunc(i, j)) {
          if (!equivDict.has(i)) equivDict.set(i, []);
          if (equivDict.has(j)) {
            equivDict.get(i).push(...equivDict.get(j));
            equivDict.delete(j);
          }
          equivDict.get(i).push(j);
          visited.add(j);
        }
      }
    }
  }

  for (const val of equivDict.values()) {
    for (const e of val) itemsToDelete.add(e);
  }
  for (const key of equivDict.keys()) {
    for (const val of equivDict.values()) {
      if (val.includes(key)) {
        throw new Error('assertion failed: key not in val');
      }
    }
  }

  newIdxList = [];
  for (let idx = 0; idx < ltlList.length; idx++) {
    if (!itemsToDelete.has(idx)) newIdxList.push(idx);
  }
  if (!retEquivDict) {
    return newIdxList;
  } else {
    return [newIdxList, equivDict];
  }
}
