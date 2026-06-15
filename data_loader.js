// JS port of data_loader.py.

import { readFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';
import OpenAI from 'openai';
import {
  apListSchema,
  validateAPList,
} from './fretish_llm_output_schema.js';
import * as nl2structnlFretish from './nl2structnl_fretish.js';
import { checkLtlFormula } from './nl2structnl_fretish.js';
import { getExtrapolateOutputs } from './nl2structnl.js';

const { dfOptionNames, decisionToItemList } = nl2structnlFretish;

console.log(dfOptionNames);

function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

export function extractOptionsForGroup(optionsPerGroup, groupIdx) {
  const res = [];
  const allCurOptions = [];
  const curDecisionIds = [];
  for (const decisionId of Object.keys(optionsPerGroup[groupIdx])) {
    allCurOptions.push(optionsPerGroup[groupIdx][decisionId]);
    curDecisionIds.push(decisionId);
  }
  for (const entry of cartesianProduct(allCurOptions)) {
    const obj = {};
    for (let i = 0; i < entry.length; i++) {
      obj[curDecisionIds[i]] = entry[i];
    }
    res.push(obj);
  }
  return res;
}

export function getAllOptionData(dfRow, optionNames) {
  const res = [];
  for (const optionName of optionNames) {
    let data;
    try {
      data = JSON.parse(dfRow[optionName]);
    } catch (e) {
      console.log(dfRow);
      console.log(optionName);
      console.log(dfRow[optionName]);
      throw e;
    }
    res.push(data);
  }
  return res;
}

export function postprocessFretishOutputsNDuration(outputList, maxNDuration) {
  const res = [];
  for (const output of outputList) {
    if (decisionContainsNDuration(output) && output.N_DURATION === null) {
      for (let nDuration = 1; nDuration <= maxNDuration; nDuration++) {
        const newOutput = { ...output };
        newOutput.N_DURATION = nDuration;
        res.push(newOutput);
      }
    } else {
      res.push(output);
    }
  }
  return res;
}

// Mirrors the Python check `"N_DURATION" in nl2structnl_fretish.extract_structnl_from_output(output)`
// i.e. whether the produced structured-NL string contains the literal "N_DURATION"
// placeholder (still unfilled).
function decisionContainsNDuration(output) {
  const structnl = nl2structnlFretish.extractStructnlFromOutput(output);
  return structnl.includes('N_DURATION');
}

export function getAllOutputsFromOptionsPerGroup(allOptionsPerGroup) {
  // all_options_per_group = option type X group X decisions
  const res = [];
  const numGroups = allOptionsPerGroup[0].length;
  for (let groupIdx = 0; groupIdx < numGroups; groupIdx++) {
    const curGroupOptions = [];
    for (const optionsPerGroup of allOptionsPerGroup) {
      curGroupOptions.push(extractOptionsForGroup(optionsPerGroup, groupIdx));
    }
    const curGroupOutputs = [];
    for (const entry of cartesianProduct(curGroupOptions)) {
      const outputDict = {};
      for (const partDict of entry) {
        Object.assign(outputDict, partDict);
      }
      curGroupOutputs.push(outputDict);
    }
    res.push(...curGroupOutputs);
  }
  return res;
}

export function getAllOutputsForDfRow(
  dfRow,
  { maxNDuration = 5, groupByTemplate = false, structnl = 'fretish' } = {}
) {
  if (structnl !== 'fretish') {
    throw new Error('only "fretish" structnl mode is supported');
  }
  const optionNames = dfOptionNames;

  const allOptionsPerGroup = getAllOptionData(dfRow, optionNames);
  // all_options_per_group = option type X group X decisions

  const outputList = getAllOutputsFromOptionsPerGroup(allOptionsPerGroup);
  let res;
  if (structnl === 'fretish' && maxNDuration !== null) {
    if (!groupByTemplate) {
      res = postprocessFretishOutputsNDuration(outputList, maxNDuration);
    } else {
      res = [];
      for (const output of outputList) {
        res.push(postprocessFretishOutputsNDuration([output], maxNDuration));
      }
    }
  } else {
    res = outputList;
  }

  for (const output of res) {
    for (const [, itemList] of Object.entries(decisionToItemList)) {
      for (const item of itemList) {
        if (!(item in output)) {
          output[item] = null;
        }
      }
    }
  }
  return res;
}

// Builds a {variable_name: description} dict from a Variables.xlsx sheet.
// This dict is the "atomic propositions glossary" injected into the LLM prompt.
export function getApDict(varDf) {
  const apDict = {};
  for (const row of varDf) {
    apDict[row['variable name']] = row['description'];
  }
  return apDict;
}

function readExcelRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

export function loadOutputs(
  resultDir,
  curDatasetName,
  rowIdx,
  model,
  numTrial,
  curMethod,
  curMode,
  { maxNDuration = null, structnl = 'fretish' } = {}
) {
  const curExpName = `${resultDir}/${curDatasetName}-${rowIdx}_model-${model}_trials-${numTrial}`;

  const curOutputs = JSON.parse(readFileSync(`${curExpName}_${curMethod}.json`, 'utf-8'));

  if (structnl !== 'fretish') {
    throw new Error('only "fretish" structnl mode is supported');
  }
  const getLtlFromOutputFunc = nl2structnlFretish.getLtlFromOutput;
  const getAllPossibleOptionsFunc = nl2structnlFretish.getAllPossibleDecisionOptionsForEx;

  let filteredOutputs = curOutputs.filter((output) =>
    checkLtlFormula(getLtlFromOutputFunc(output))
  );

  if (curMode === 'extra') {
    filteredOutputs = getExtrapolateOutputs(filteredOutputs, {
      MAX_DURATION: maxNDuration,
      getLtlFromOutputFunc,
      getAllPossibleOptionsFunc,
    });
  }

  const outputLtlList = filteredOutputs.map((entry) => getLtlFromOutputFunc(entry));
  return [filteredOutputs, outputLtlList];
}

export function loadLabels(dataHomeDir, curDatasetName, rowIdx, { maxNDuration = null, curDfFile = null, structnl = 'fretish' } = {}) {
  if (curDfFile === null) {
    curDfFile = `${dataHomeDir}${curDatasetName}/PlausibleSpecs.xlsx`;
  }
  const df = readExcelRows(curDfFile);
  const labelOutputList = getAllOutputsForDfRow(df[rowIdx], { maxNDuration, structnl });
  if (structnl !== 'fretish') {
    throw new Error('only "fretish" structnl mode is supported');
  }
  const labelLtlList = labelOutputList.map((output) => nl2structnlFretish.getLtlFromOutput(output));
  return [labelOutputList, labelLtlList];
}

// Identifiers must follow the FRET grammar's ID rule: start with a letter,
// followed by letters, digits, or underscores (e.g. "limits", "state_is_NOMINAL").
const AP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// Words reserved by the FRET requirements grammar (matched case-insensitively,
// since the grammar's keyword fragments are case-insensitive) and therefore
// unusable as variable names.
const FRET_RESERVED_WORDS = new Set([
  'after', 'always', 'and', 'at', 'before', 'during', 'eventually', 'except',
  'false', 'finally', 'first', 'for', 'hour', 'hours', 'if', 'immediately',
  'in', 'initially', 'is', 'last', 'microsecond', 'microseconds',
  'millisecond', 'milliseconds', 'minute', 'minutes', 'mod', 'mode',
  'never', 'next', 'not', 'occurrence', 'of', 'only', 'or', 'previous',
  'probability', 'same', 'satisfy', 'second', 'seconds', 'shall', 'the',
  'then', 'tick', 'ticks', 'timepoint', 'true', 'unless', 'until', 'upon',
  'what', 'when', 'whenever', 'where', 'while', 'with', 'within', 'xor',
]);

// Validate raw JSON from Ollama for AP generation. Returns error string or null.
function checkApOutput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return `Invalid format: ${e}`;
  }
  const validationErr = validateAPList(parsed);
  if (validationErr !== null) {
    return validationErr;
  }
  if (parsed.atomic_propositions.length === 0) {
    return 'No atomic propositions were generated. Please generate at least one.';
  }
  const bad = parsed.atomic_propositions
    .filter((ap) => !AP_ID_RE.test(ap.variable_name))
    .map((ap) => ap.variable_name);
  if (bad.length > 0) {
    return (
      `The following variable names are not valid identifiers: ${JSON.stringify(bad)}. ` +
      'Variable names must start with a letter and contain only letters, ' +
      "digits, and underscores (e.g. 'limits', 'state_is_NOMINAL')."
    );
  }
  const reserved = parsed.atomic_propositions
    .filter((ap) => FRET_RESERVED_WORDS.has(ap.variable_name.toLowerCase()))
    .map((ap) => ap.variable_name);
  if (reserved.length > 0) {
    return (
      `The following variable names are reserved words in the FRET ` +
      `requirements grammar and cannot be used: ${JSON.stringify(reserved)}. ` +
      'Please choose different variable names.'
    );
  }
  return null;
}

// Query Ollama to generate atomic propositions (variable name + description) for a dataset.
export async function generateApDictViaOllama(dataHomeDir, curDatasetName, { model = 'qwen2.5:32b', maxRetry = 3 } = {}) {
  const curDfFile = `${dataHomeDir}${curDatasetName}/PlausibleSpecs.xlsx`;
  const df = readExcelRows(curDfFile);
  const nlRequirements = df.map((row) => row['NL']).filter((v) => v !== null && v !== undefined);

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  // Large local models can take much longer than the SDK's 10-minute default to respond.
  // Override via OLLAMA_TIMEOUT_MS if needed.
  const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 1_800_000;
  const ollamaClient = new OpenAI({ baseURL: ollamaBaseUrl, apiKey: 'ollama', timeout: ollamaTimeoutMs });

  const systemPrompt =
    'You are an expert in requirements engineering and formal specification. ' +
    'Given a list of natural language requirements, identify all atomic boolean propositions ' +
    '(system state variables) needed to express them formally as FRETish requirements. ' +
    'For each proposition provide a variable name and a brief description. ' +
    "Variable names must be valid identifiers in the FRET requirements grammar: they must " +
    'start with a letter and contain only letters, digits, and underscores (no spaces, ' +
    'hyphens, or other special characters), and must not be one of FRET\'s reserved words ' +
    '(e.g. shall, when, if, mode, and, or, not, true, false, until, within). ' +
    'Use lowercase snake_case names for ordinary variables (e.g. "sensor_is_active"). ' +
    'For a variable that represents a finite-state-machine being in a particular mode, ' +
    'use the pattern "state_is_<MODE_NAME>" with the mode name in upper case ' +
    '(e.g. "state_is_NOMINAL", "state_is_FAULT"). ' +
    'IMPORTANT: requirements often give the exact variable name to use in parentheses, ' +
    'e.g. "the autopilot is requesting support (request)" or "limits are not exceeded ' +
    '(not limits)". When a requirement contains such a hint, you MUST use that hint ' +
    '(stripped of words like "not"/"is"/"are", lowercased) as the variable_name ' +
    'verbatim, instead of inventing a longer descriptive name. Only invent a new ' +
    'snake_case name for concepts that have no such hint. ' +
    'Generate one entry per distinct concept; do not generate duplicate or near-duplicate ' +
    'propositions for the same concept. ' +
    'Respond with a single JSON object only, with no extra text, commentary, or markdown ' +
    'code fences, in exactly this format:\n' +
    '{"atomic_propositions": [{"variable_name": "request", ' +
    '"description": "True when the autopilot is requesting support"}, ' +
    '{"variable_name": "state_is_NOMINAL", ' +
    '"description": "True when the system is in the NOMINAL state"}]}';
  const userPrompt =
    'Generate atomic propositions for the following requirements:\n' + JSON.stringify(nlRequirements, null, 2);

  const messages = [
    { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ];
  let raw = null;
  for (let trial = 0; trial < maxRetry; trial++) {
    console.log(`Querying Ollama (model=${model}, this may take several minutes for large local models)...`);
    const response = await ollamaClient.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
    });
    raw = response.choices[0].message.content;
    if (!raw) {
      console.log(
        `AP generation: empty response from Ollama (trial ${trial + 1}). ` +
          `finish_reason=${JSON.stringify(response.choices[0].finish_reason)}, ` +
          `message=${JSON.stringify(response.choices[0].message)}`
      );
    }
    const errorMsg = checkApOutput(raw);
    if (errorMsg === null) {
      break;
    }
    console.log(`AP generation error (trial ${trial + 1}): ${errorMsg}`);
    messages.push({ role: 'assistant', content: [{ type: 'text', text: raw }] });
    messages.push({ role: 'user', content: [{ type: 'text', text: errorMsg }] });
  }

  let apDict = null;
  try {
    const parsed = JSON.parse(raw);
    if (validateAPList(parsed) === null) {
      apDict = {};
      for (const ap of parsed.atomic_propositions) {
        apDict[ap.variable_name] = ap.description;
      }
    }
  } catch {
    apDict = null;
  }
  return [apDict, raw];
}

// Loads the atomic propositions glossary for a dataset.
// Returns [apDict, ollamaApOutput]:
//   apDict is the {name: description} glossary actually used for formalization.
//   ollamaApOutput is the raw Ollama response from generateApDictViaOllama,
//   or null if Ollama wasn't queried.
//
// If alwaysGenerate is true (or Variables.xlsx is absent), queries Ollama to
// generate propositions and uses that result for formalization.
// Otherwise, apDict is built from Variables.xlsx.
// Falls back to the ap_dict column in PlausibleSpecs.xlsx if Ollama generation is
// not requested and Variables.xlsx is absent.
export async function loadVars(dataHomeDir, curDatasetName, { rowIdx = null, alwaysGenerate = false, model = 'qwen2.5:32b' } = {}) {
  const curVarFile = `${dataHomeDir}${curDatasetName}/Variables.xlsx`;
  if (alwaysGenerate || !existsSync(curVarFile)) {
    console.log(`Generating atomic propositions via Ollama for ${curDatasetName}...`);
    const [ollamaApDict, ollamaApOutput] = await generateApDictViaOllama(dataHomeDir, curDatasetName, { model });
    if (ollamaApDict !== null) {
      return [ollamaApDict, ollamaApOutput];
    }
    if (existsSync(curVarFile)) {
      const varDf = readExcelRows(curVarFile);
      return [getApDict(varDf), ollamaApOutput];
    }
    throw new Error('Ollama atomic proposition generation failed and no Variables.xlsx present!');
  }

  if (existsSync(curVarFile)) {
    const varDf = readExcelRows(curVarFile);
    return [getApDict(varDf), null];
  }

  const curDfFile = `${dataHomeDir}${curDatasetName}/PlausibleSpecs.xlsx`;
  if (existsSync(curDfFile)) {
    const df = readExcelRows(curDfFile);
    return [JSON.parse(df[rowIdx]['ap_dict']), null];
  }
  throw new Error('cannot load ap_dict!');
}
