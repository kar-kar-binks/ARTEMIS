// JS port of metrics.py.
//
// Per the JS-port decision to drop Spot support:
//  - `get_all_metrics`: the Spot-based `determine_timeout_idx`/`spot.translate`/
//    `spot.contains`/`spot.product` path is removed. All formula pairs are now routed
//    through the NuSMV job path (`nusmv_jobs`), which the Python code already built
//    for formulas that timed out in Spot - this preserves the
//    equal/subset/superset/overlap semantics via `dispatchBatchMC`/
//    `parallelDispatchBatchMC` (NuSMV-only after batch_check.js's port).
//  - `get_coverage_metric`: `spot.translate` + `spot.are_equivalent` is replaced with
//    `nusmvUtils.getNusmvLtlEquivalent` per formula pair (functionally equivalent
//    semantic check).
//  - `get_all_metrics_old` (dead/commented-out alternative) was dropped.

import * as spotUtils from './spot_utils.js';
import * as nusmvUtils from './nusmv_utils.js';
import { dispatchBatchMC, parallelDispatchBatchMC } from './batch_check.js';

export async function getAllMetrics(ltlList, labelLtlList, { equalOnly = false, timeout = null, isParallel = false, nusmvJobsPerThread = 1, bmcK = null } = {}) {
  const nusmvJobs = [];
  for (let i = 0; i < ltlList.length; i++) {
    for (let j = 0; j < labelLtlList.length; j++) {
      nusmvJobs.push(['equivalence', [ltlList[i], labelLtlList[j]]]);
      if (!equalOnly) {
        nusmvJobs.push(['subset', [ltlList[i], labelLtlList[j]]]);
        nusmvJobs.push(['superset', [ltlList[i], labelLtlList[j]]]);
        nusmvJobs.push(['overlap', [ltlList[i], labelLtlList[j]]]);
      }
    }
  }

  console.log(nusmvJobs.length);
  let nusmvResults;
  if (!isParallel) {
    nusmvResults = dispatchBatchMC(nusmvJobs, { spotTimeout: 0, nusmvTimeout: timeout, nusmvJobsPerThread, bmcK });
  } else {
    nusmvResults = await parallelDispatchBatchMC(nusmvJobs, {
      jobsPerThread: Math.floor(nusmvJobs.length / 10),
      spotTimeout: 0,
      nusmvTimeout: timeout,
      nusmvJobsPerThread,
      bmcK,
    });
  }
  if (nusmvResults.length !== nusmvJobs.length) {
    throw new Error('assertion failed: len(nusmv_results) == len(nusmv_jobs)');
  }

  const resList = [];
  let nusmvResIdx = 0;
  for (let i = 0; i < ltlList.length; i++) {
    const curEquivResults = [];
    const curSubsetResults = [];
    const curSupersetResults = [];
    const curOverlapResults = [];
    for (let j = 0; j < labelLtlList.length; j++) {
      curEquivResults.push(nusmvResults[nusmvResIdx]);
      nusmvResIdx += 1;
      if (!equalOnly) {
        curSubsetResults.push(nusmvResults[nusmvResIdx]);
        nusmvResIdx += 1;
        curSupersetResults.push(nusmvResults[nusmvResIdx]);
        nusmvResIdx += 1;
        curOverlapResults.push(nusmvResults[nusmvResIdx]);
        nusmvResIdx += 1;
      }
    }
    const isEqual = curEquivResults.some(Boolean);
    if (!equalOnly) {
      const isSubset = curSubsetResults.some(Boolean);
      const isSuperset = curSupersetResults.some(Boolean);
      const isOverlap = curOverlapResults.some(Boolean);
      resList.push([isEqual, isSubset, isSuperset, isSubset && isSuperset, isOverlap]);
    } else {
      resList.push([isEqual]);
    }
  }
  if (nusmvResIdx !== nusmvJobs.length) {
    throw new Error('assertion failed: nusmv_res_idx == len(nusmv_jobs)');
  }
  return resList;
}

export function getCoverageMetric(ltlList, groupLabelLtlList) {
  const resList = [];
  for (let i = 0; i < groupLabelLtlList.length; i++) {
    let isEqual = false;
    for (const entry of ltlList) {
      for (const labelEntry of groupLabelLtlList[i]) {
        const varDict = {};
        for (const v of spotUtils.getVariablesFromFormula(entry)) varDict[v] = 'boolean';
        for (const v of spotUtils.getVariablesFromFormula(labelEntry)) varDict[v] = 'boolean';
        if (nusmvUtils.getNusmvLtlEquivalent(varDict, entry, varDict, labelEntry)) {
          isEqual = true;
          break;
        }
      }
      if (isEqual) break;
    }
    resList.push([isEqual]);
  }
  return resList;
}
