// JS port of nusmv_utils.py.

import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';

export function callNusmv(smvFile, bmcK = null, timeout = null) {
  const curTool = 'nuXmv';
  try {
    const args = [];
    if (bmcK !== null) {
      args.push('-bmc', '-bmc_length', String(bmcK), '-ctt', smvFile);
    } else {
      args.push(smvFile);
    }
    const result = spawnSync(curTool, args, {
      encoding: 'utf-8',
      timeout: timeout != null ? timeout * 1000 : undefined,
    });
    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') {
        throw new TimeoutError(`nusmv exceeded timeout of ${timeout} seconds`);
      }
      return [String(result.error), null];
    }
    if (result.signal === 'SIGTERM' && timeout != null) {
      throw new TimeoutError(`nusmv exceeded timeout of ${timeout} seconds`);
    }
    return [result.stdout, result.stderr];
  } catch (e) {
    if (e instanceof TimeoutError) {
      throw e;
    }
    return [String(e), null];
  }
}

export class TimeoutError extends Error {}

export function detectCounterexample(output) {
  if (/-- specification.*is false/.test(output)) {
    return true;
  } else if (/-- specification.*is true/.test(output)) {
    return false;
  } else if (/-- no counterexample found with bound/.test(output)) {
    return false;
  } else {
    console.log(output);
    throw new Error('could not tell if nusmv returns a trace or not');
  }
}

export function parseNusmvTrace(output) {
  const assignmentPattern = /\s*([\w.]+)\s*=\s*(\w+)/;
  const lines = output.split('\n');
  const traceList = [];
  let isFoundLoop = false;
  let loopIdx = 0;
  for (const line of lines) {
    if (/-- specification.*is false/.test(line)) {
      // pass
    } else if (/-> State: */.test(line)) {
      if (traceList.length > 1) {
        const prev = traceList[traceList.length - 2];
        const last = traceList[traceList.length - 1];
        for (const varName of Object.keys(prev)) {
          if (!(varName in last)) {
            last[varName] = prev[varName];
          }
        }
      }
      traceList.push({});
      if (!isFoundLoop) {
        loopIdx += 1;
      }
    } else if (assignmentPattern.test(line)) {
      const match = assignmentPattern.exec(line);
      const varName = match[1];
      const varValue = match[2];
      traceList[traceList.length - 1][varName] = varValue;
    } else if (/-- Loop starts here/.test(line)) {
      isFoundLoop = true;
    }
  }
  if (traceList.length > 1) {
    const prev = traceList[traceList.length - 2];
    const last = traceList[traceList.length - 1];
    for (const varName of Object.keys(prev)) {
      if (!(varName in last)) {
        last[varName] = prev[varName];
      }
    }
  }
  const prefixList = traceList.slice(0, loopIdx);
  const cycleList = traceList.slice(loopIdx, -1);
  return [
    prefixList.filter((e) => Object.keys(e).length > 0),
    cycleList.filter((e) => Object.keys(e).length > 0),
  ];
}

export function nusmvConstructStr(propList) {
  if (propList.length === 0) {
    return 'TRUE';
  }
  let resStr = '';
  const varAssignment0 = Object.entries(propList[0]).map(([varName, val]) =>
    val === 'TRUE' ? `(${varName})` : `!(${varName})`
  );
  resStr += `(${varAssignment0.join(' & ')})`;
  for (let i = 1; i < propList.length; i++) {
    const varAssignment = Object.entries(propList[i]).map(([varName, val]) =>
      val === 'TRUE' ? `(${varName})` : `!(${varName})`
    );
    resStr += ' & (' + ' X '.repeat(i) + '(' + varAssignment.join(' & ') + ') ) ';
  }
  return `(${resStr})`;
}

export function nusmvTraceToFormula(trace) {
  const [prefixList, cycleList] = trace;
  const prefixStr = nusmvConstructStr(prefixList);
  if (cycleList.length > 0) {
    const cycleStr = nusmvConstructStr(cycleList);
    const cycleConditionStr =
      ' G ' + '(' + cycleStr + ' <-> (' + ' X '.repeat(cycleList.length) + cycleStr + ' ) )';
    const fullForm =
      prefixStr +
      ' & ' +
      ' X '.repeat(prefixList.length) +
      cycleStr +
      ' & ' +
      ' X '.repeat(prefixList.length) +
      cycleConditionStr;
    return fullForm;
  } else {
    return prefixStr;
  }
}

export function nusmvFormulaToFile(smvFname, varDict, formulaStr) {
  let totalStr = 'MODULE main\n';
  totalStr += 'VAR\n';
  for (const [varName, varType] of Object.entries(varDict)) {
    totalStr += varName + ' : ' + varType + ';\n';
  }
  totalStr += 'JUSTICE TRUE;\n';
  totalStr += 'LTLSPEC\n';
  totalStr += formulaStr;
  writeFileSync(smvFname, totalStr);
}

export function checkValidNusmvFormula(varDict, formulaStr, retString = false, smvFname = 'tmp1.smv') {
  const validFormulaStr = '( ' + formulaStr + ') & !(' + formulaStr + ' )';
  nusmvFormulaToFile(smvFname, varDict, validFormulaStr);
  const [, rawErr] = callNusmv(smvFname);
  if (!retString) {
    return rawErr === '';
  } else {
    return rawErr;
  }
}

export function fixNusmvTrace(trace, fStr, varDict, bmcK) {
  const [badPrefix, badCycle] = trace;
  for (let i = 0; i < badCycle.length; i++) {
    const newTrace = [badPrefix.concat(badCycle.slice(0, i)), badCycle.slice(i)];
    const modTraceFormula = nusmvTraceToFormula(newTrace);
    if (getNusmvLtlSatisfiable(varDict, `(${fStr}) & (${modTraceFormula})`, bmcK) !== null) {
      return newTrace;
    }
  }
  return null;
}

export function getNusmvLtlSatisfiable(
  varDict,
  formulaStr,
  bmcK = null,
  useTrace = false,
  timeout = null,
  smvFname = 'tmp1.smv'
) {
  const tmpFormulaStr = '!(' + formulaStr + ')';
  nusmvFormulaToFile(smvFname, varDict, tmpFormulaStr);
  const [rawOut, rawErr] = callNusmv(smvFname, bmcK, timeout);
  if (rawErr === '') {
    if (detectCounterexample(rawOut)) {
      const trace = parseNusmvTrace(rawOut);
      if (useTrace) {
        return fixNusmvTrace(trace, formulaStr, varDict, bmcK);
      } else {
        return trace;
      }
    } else {
      return null;
    }
  } else if (rawErr.includes('The initial states set of the finite state machine is empty.')) {
    return null;
  } else {
    throw new Error(rawErr);
  }
}

export function getNusmvLtlTrue(varDict, formulaStr, bmcK = null, timeout = null, smvFname = 'tmp1.smv') {
  // return None if true
  nusmvFormulaToFile(smvFname, varDict, formulaStr);
  const [rawOut, rawErr] = callNusmv(smvFname, bmcK, timeout);
  if (rawErr === '') {
    if (detectCounterexample(rawOut)) {
      return parseNusmvTrace(rawOut);
    } else {
      return null;
    }
  } else if (rawErr.includes('The initial states set of the finite state machine is empty.')) {
    return null;
  } else {
    throw new Error(rawErr);
  }
}

export function getNusmvLtlEquivalent(
  varDictA,
  formulaStrA,
  varDictB,
  formulaStrB,
  bmcK = null,
  timeout = null,
  smvFname = 'tmp1.smv'
) {
  const totalVarDict = { ...varDictA };
  for (const [varName, varType] of Object.entries(varDictB)) {
    totalVarDict[varName] = varType;
  }
  const totalFormula =
    '( ( ' + formulaStrA + ' ) & !( ' + formulaStrB + ' ) ) | ( !( ' + formulaStrA + ' ) & ( ' + formulaStrB + ' ) )';
  const trace = getNusmvLtlSatisfiable(totalVarDict, totalFormula, bmcK, false, timeout, smvFname);
  return trace === null;
}

export function getMinVarDict(inVarDict, ltlStr) {
  const outVarDict = { ...inVarDict };
  for (const [k, v] of Object.entries(inVarDict)) {
    delete outVarDict[k];
    if (!checkValidNusmvFormula(outVarDict, ltlStr)) {
      outVarDict[k] = v;
    }
  }
  return outVarDict;
}

export function getNumVarsInTrace(trace) {
  const [prefixList, cycleList] = trace;
  if (prefixList.length > 0) {
    return Object.keys(prefixList[0]).length;
  } else if (cycleList.length > 0) {
    return Object.keys(cycleList[0]).length;
  } else {
    return 0;
  }
}
