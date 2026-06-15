// JS port of nl2structnl_fretish.py.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as llmPrompt from './llm_prompt.js';
import {
  structuredNLTranslationsSchema,
  validateStructuredNLTranslations,
} from './fretish_llm_output_schema.js';

// ---------------------------------------------------------------------------
// Formula helpers (formerly spot_utils.js's pure-JS fallbacks)
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

export function checkValidNonnegativeInteger(fStr) {
  const val = Number(fStr);
  return Number.isInteger(val) && val > 0;
}

// Mimics Python's json.dumps() default separators=(', ', ': ') formatting,
// for byte-identical LLM prompt text.
function pyJsonDumps(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => pyJsonDumps(v)).join(', ')}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${pyJsonDumps(v)}`);
  return `{${entries.join(', ')}}`;
}

// Loaded lazily (rather than at module-load time) so that callers can set
// DATA_HOME_DIR after importing this module (matching how run_llm.ipynb sets
// os.environ["DATA_HOME_DIR"] before the equivalent Python module-level `open(...)`
// is reached via the first `import data_loader`).
const _moduleDir = dirname(fileURLToPath(import.meta.url));

let _structnlToLtlDict = null;
function getStructnlToLtlDict() {
  if (_structnlToLtlDict === null) {
    _structnlToLtlDict = JSON.parse(
      readFileSync(join(_moduleDir, 'fretish_structnl_to_ltl_dict.json'), 'utf-8')
    );
  }
  return _structnlToLtlDict;
}

export const prefixNlTemplateStr = `
To produce the structured natural language property, you compose it from a set of templates.
If the chosen option contains boolean expression placeholders (i.e., bool_exp1, bool_exp2, bool_exp3, bool_exp4), you need to produce boolean expressions that will replace the placeholders.
Boolean expressions can only contain boolean operators (e.g., !, &, |, ->, <->) and can only atomic propositions (NO NUMERICAL COMPARISON OPERATORS ALLOWED)
`;

export const structnlExampleStr = `
Example of a valid output (your field names and decision values must match exactly):
{
  "translations": [
    {
      "explanation": "Upon the trigger condition, the system must immediately satisfy the target state.",
      "decision1": "_ABSTRACT_VAR1_",
      "bool_exp1": "",
      "decision2": "upon bool_exp2, _ABSTRACT_VAR2_",
      "bool_exp2": "trigger_condition",
      "decision3": "immediately satisfy bool_exp3",
      "bool_exp3": "target_state",
      "bool_exp4": "",
      "N_DURATION": null,
      "decision1_substring": "",
      "decision2_substring": "when the trigger condition occurs",
      "decision3_substring": "immediately satisfy the target state"
    }
  ]
}
`;

export const structnlSchemaStr = `
Output schema (StructuredNLTranslations):
- translations: a list of objects, each with exactly the following fields:

  - explanation (string): explanation of how this structured NL property captures the input_natural_language.

  - decision1 (string, must be exactly one of the following options):
      "while bool_exp1, _ABSTRACT_VAR1_"
      "only while bool_exp1, _ABSTRACT_VAR1_"
      "before bool_exp1, _ABSTRACT_VAR1_"
      "only before bool_exp1, _ABSTRACT_VAR1_"
      "after bool_exp1, _ABSTRACT_VAR1_"
      "only after bool_exp1, _ABSTRACT_VAR1_"
      "whenever bool_exp1, _ABSTRACT_VAR1_"
      "upon bool_exp1, _ABSTRACT_VAR1_"
      "_ABSTRACT_VAR1_"

  - bool_exp1 (string): the boolean expression to substitute for bool_exp1 in decision1.
      Use "" (empty string) if decision1 is "_ABSTRACT_VAR1_".

  - decision2 (string, must be exactly one of the following options):
      "whenever bool_exp2, _ABSTRACT_VAR2_"
      "upon bool_exp2, _ABSTRACT_VAR2_"
      "_ABSTRACT_VAR2_"

  - bool_exp2 (string): the boolean expression to substitute for bool_exp2 in decision2.
      Use "" (empty string) if decision2 is "_ABSTRACT_VAR2_".

  - decision3 (string, must be exactly one of the following options):
      "immediately satisfy bool_exp3"
      "within N_DURATION ticks satisfy bool_exp3"
      "after N_DURATION ticks satisfy bool_exp3"
      "until bool_exp4, satisfy bool_exp3"
      "always satisfy bool_exp3"
      "never satisfy bool_exp3"
      "at the next timepoint satisfy bool_exp3"
      "eventually satisfy bool_exp3"
      "for N_DURATION ticks satisfy bool_exp3"
      "before bool_exp4, satisfy bool_exp3"

  - bool_exp3 (string): the boolean expression to substitute for bool_exp3 in decision3.

  - bool_exp4 (string): the boolean expression to substitute for bool_exp4 in decision3.
      Use "" (empty string) if decision3 does not contain the bool_exp4 placeholder.

  - N_DURATION (integer or null): the number of ticks to substitute for N_DURATION in decision3.
      Use null if decision3 does not contain the N_DURATION placeholder.

  - decision1_substring (string): the substring of input_natural_language that corresponds to decision1.
      Use "" (empty string) if decision1 is "_ABSTRACT_VAR1_".

  - decision2_substring (string): the substring of input_natural_language that corresponds to decision2.
      Use "" (empty string) if decision2 is "_ABSTRACT_VAR2_".

  - decision3_substring (string): the substring of input_natural_language that corresponds to decision3.

All twelve fields above are required for every entry in translations.
`;

export const structnlDcmpFormatStr = `
Inputs consist of:
1. unstructured natural language (string)
2. atomic proposition + descriptions (dictionary mapping names to descriptions). You must use these atomic propositions to define the boolean expressions and account for their descriptions in your decisions.
3. nl_substring_to_decision_map. The option you choose for decision1, decision2, and decision3 should represent its corresponding substrings of the input unstructured natural language.

The Outputs consist of the arguments to the produce_structured_nl function and substrings of the input that pertain to each decision:
1. an explanation of the produced structured NL property and how it captures the input_natural_language
2. decision1 (should contain its placeholders names)
3. bool_exp1
4. decision2 (should contain its placeholders names)
5. bool_exp2
6. decision3 (should contain its placeholders names)
7. bool_exp3
8. bool_exp4
9. N_DURATION
10. decision1_substring (substring of input_natural_language that pertains to decision1)
11. decision2_substring (substring of input_natural_language that pertains to decision2)
12. decision3_substring (substring of input_natural_language that pertains to decision3)
`;

export const structnlFormatStr = `
Inputs consist of:
1. unstructured natural language (string)
2. atomic proposition + descriptions (dictionary mapping names to descriptions). You must use these atomic propositions to define the boolean expressions and account for their descriptions in your decisions.

The Outputs consist of the arguments to the produce_structured_nl function:
1. an explanation of the produced structured NL property and how it captures the input_natural_language
2. decision1 (should contain its placeholders names)
3. bool_exp1
4. decision2 (should contain its placeholders names)
5. bool_exp2
6. decision3 (should contain its placeholders names)
7. bool_exp3
8. bool_exp4
9. N_DURATION
10. decision1_substring (substring of input_natural_language that pertains to decision1)
11. decision2_substring (substring of input_natural_language that pertains to decision2)
12. decision3_substring (substring of input_natural_language that pertains to decision3)
`;

export const ltltemplateFormatStr = `
Inputs consist of:
1. unstructured natural language
2. atomic proposition + descriptions (dictionary mapping names to descriptions). You must use these atomic propositions to define the boolean expressions and account for their descriptions in your choice of LTL template.

The Outputs consist of:
1. an explanation of the produced LTL property and how it captures the input_natural_language
2. chosen_template_ID (integer) - The index of the chosen LTL template
3. bool_exp1
4. bool_exp2
5. bool_exp3
6. bool_exp4
7. N_DURATION
`;

export const decision1Options = [
  'while bool_exp1, _ABSTRACT_VAR1_',
  'only while bool_exp1, _ABSTRACT_VAR1_',
  'before bool_exp1, _ABSTRACT_VAR1_',
  'only before bool_exp1, _ABSTRACT_VAR1_',
  'after bool_exp1, _ABSTRACT_VAR1_',
  'only after bool_exp1, _ABSTRACT_VAR1_',
  'whenever bool_exp1, _ABSTRACT_VAR1_',
  'upon bool_exp1, _ABSTRACT_VAR1_',
  '_ABSTRACT_VAR1_',
];

export const decision2Options = [
  'whenever bool_exp2, _ABSTRACT_VAR2_',
  'upon bool_exp2, _ABSTRACT_VAR2_',
  '_ABSTRACT_VAR2_',
];

export const decision3Options = [
  'immediately satisfy bool_exp3',
  'within N_DURATION ticks satisfy bool_exp3',
  'after N_DURATION ticks satisfy bool_exp3',
  'until bool_exp4, satisfy bool_exp3',
  'always satisfy bool_exp3',
  'never satisfy bool_exp3',
  'at the next timepoint satisfy bool_exp3',
  'eventually satisfy bool_exp3',
  'for N_DURATION ticks satisfy bool_exp3',
  'before bool_exp4, satisfy bool_exp3',
];

export const decisionOptionsStr = `
decision1_options = [
    "while bool_exp1, _ABSTRACT_VAR1_",
    "before bool_exp1, _ABSTRACT_VAR1_",
    "after bool_exp1, _ABSTRACT_VAR1_",
    "whenever bool_exp1, _ABSTRACT_VAR1_",
    "upon bool_exp1, _ABSTRACT_VAR1_",
    "only while bool_exp1, _ABSTRACT_VAR1_",
    "only before bool_exp1, _ABSTRACT_VAR1_",
    "only after bool_exp1, _ABSTRACT_VAR1_",
    "_ABSTRACT_VAR1_"
]

decision2_options = [
    "whenever bool_exp2, _ABSTRACT_VAR2_",
    "upon bool_exp2, _ABSTRACT_VAR2_",
    "_ABSTRACT_VAR2_",
]

decision3_options = [
    'immediately satisfy bool_exp3',
    'within N_DURATION ticks satisfy bool_exp3',
    'after N_DURATION ticks satisfy bool_exp3',
    'until bool_exp4, satisfy bool_exp3',
    'always satisfy bool_exp3',
    'never satisfy bool_exp3',
    'at the next timepoint satisfy bool_exp3',
    'eventually satisfy bool_exp3',
    'for N_DURATION ticks satisfy bool_exp3',
    'before bool_exp4, satisfy bool_exp3'
]
`;

export const dfOptionNames = [
  'timing options',
  'timing bool exps',
  'scope 1 options',
  'scope 1 bool exps',
  'scope 2 options',
  'scope 2 bool exps',
];

export const decisionToItemList = {
  decision1: ['bool_exp1'],
  decision2: ['bool_exp2'],
  decision3: ['bool_exp3', 'bool_exp4', 'N_DURATION'],
};

export const decisionOrder = ['decision1', 'decision2', 'decision3'];

// Generates a structured natural language statement based on input templates and
// boolean expressions.
export function produceStructuredNl(
  decision1,
  boolExp1,
  decision2,
  boolExp2,
  decision3,
  boolExp3,
  boolExp4,
  nDuration
) {
  // must be using valid options for each decision
  if (!decision1Options.includes(decision1)) throw new Error('invalid decision1');
  if (!decision2Options.includes(decision2)) throw new Error('invalid decision2');
  if (!decision3Options.includes(decision3)) throw new Error('invalid decision3');

  // Step 1: Process decision1 with bool_exp1
  let decision1Instance;
  if (decision1.includes('bool_exp1')) {
    decision1Instance = decision1.replace('bool_exp1', boolExp1);
  } else {
    decision1Instance = decision1;
  }

  // Step 2: Process decision2 with bool_exp2
  let decision2Instance;
  if (decision2.includes('bool_exp2')) {
    decision2Instance = decision2.replace('bool_exp2', boolExp2);
  } else {
    decision2Instance = decision2;
  }

  // Replace _ABSTRACT_VAR1_ with decision2_instance
  let result = decision1Instance.replace('_ABSTRACT_VAR1_', decision2Instance);

  // Step 3: Process decision3 with bool_exp3, bool_exp4, and N_DURATION
  let decision3Instance = decision3.replace('bool_exp3', boolExp3);

  if (decision3.includes('bool_exp4') && boolExp4 !== null && boolExp4 !== undefined) {
    decision3Instance = decision3Instance.replace('bool_exp4', boolExp4);
  }

  if (decision3.includes('N_DURATION') && nDuration !== null && nDuration !== undefined) {
    decision3Instance = decision3Instance.replace('N_DURATION', String(nDuration));
  }

  // Replace _ABSTRACT_VAR2_ with decision3_instance
  result = result.replace('_ABSTRACT_VAR2_', decision3Instance);

  return result;
}

export function extractStructnlFromOutput(output) {
  const argNames = [
    'decision1',
    'bool_exp1',
    'decision2',
    'bool_exp2',
    'decision3',
    'bool_exp3',
    'bool_exp4',
    'N_DURATION',
  ];
  const argDict = {};
  for (const k of argNames) {
    argDict[k] = k in output ? output[k] : null;
  }
  return produceStructuredNl(
    argDict.decision1,
    argDict.bool_exp1,
    argDict.decision2,
    argDict.bool_exp2,
    argDict.decision3,
    argDict.bool_exp3,
    argDict.bool_exp4,
    argDict.N_DURATION
  );
}

export function checkNl2structnlFormat(rawOutput, { ap_dict: apDict, dcmp = null } = {}) {
  let jsonRawOutput;
  try {
    jsonRawOutput = JSON.parse(rawOutput);
  } catch (e) {
    return `${e}`;
  }
  const validationErr = validateStructuredNLTranslations(jsonRawOutput);
  if (validationErr !== null) {
    return validationErr;
  }
  for (let i = 0; i < jsonRawOutput.translations.length; i++) {
    const jsonOutput = jsonRawOutput.translations[i];
    const errMsg = checkNl2structnlFormatInner(jsonOutput, apDict, dcmp);
    if (errMsg !== null) {
      return `please fix your output list after addressing the following problem in the ${i}-th item: ${errMsg}`;
    }
  }
  return null;
}

export function checkNl2structnlFormatInner(jsonOutput, apDict, _dcmp = null) {
  const boolVarMsg = `Boolean expressions must only contain variables from the following: ${JSON.stringify(
    Object.keys(apDict)
  )}`;
  if (!decision1Options.includes(jsonOutput.decision1)) {
    return `Invalid option for decision1. decision1 must be chosen from the following options: ${JSON.stringify(
      decision1Options
    )}`;
  }
  if (!decision2Options.includes(jsonOutput.decision2)) {
    return `Invalid option for decision2. decision2 must be chosen from the following options: ${JSON.stringify(
      decision2Options
    )}`;
  }
  if (!decision3Options.includes(jsonOutput.decision3)) {
    return `Invalid option for decision3. decision3 must be chosen from the following options: ${JSON.stringify(
      decision3Options
    )}`;
  }
  if (jsonOutput.decision1.includes('bool_exp1')) {
    const errMsg = checkBooleanFormula(jsonOutput.bool_exp1, true);
    if (errMsg !== '') {
      return `bool_exp1 ${jsonOutput.bool_exp1} is not a valid boolean expression:\n${errMsg}`;
    }
    for (const varName of getVariablesFromFormula(jsonOutput.bool_exp1)) {
      if (!(varName in apDict)) {
        return `bool_exp1: ${varName} is not a valid atomic proposition. ${boolVarMsg}`;
      }
    }
  }
  if (jsonOutput.decision2.includes('bool_exp2')) {
    const errMsg = checkBooleanFormula(jsonOutput.bool_exp2, true);
    if (errMsg !== '') {
      return `bool_exp2 ${jsonOutput.bool_exp2} is not a valid boolean expression:\n${errMsg}`;
    }
    for (const varName of getVariablesFromFormula(jsonOutput.bool_exp2)) {
      if (!(varName in apDict)) {
        return `bool_exp2: ${varName} is not a valid atomic proposition. ${boolVarMsg}`;
      }
    }
  }
  if (jsonOutput.decision3.includes('bool_exp3')) {
    const errMsg = checkBooleanFormula(jsonOutput.bool_exp3, true);
    if (errMsg !== '') {
      return `bool_exp3 ${jsonOutput.bool_exp3} is not a valid boolean expression:\n${errMsg}`;
    }
    for (const varName of getVariablesFromFormula(jsonOutput.bool_exp3)) {
      if (!(varName in apDict)) {
        return `bool_exp3: ${varName} is not a valid atomic proposition. ${boolVarMsg}`;
      }
    }
  }
  if (jsonOutput.decision3.includes('bool_exp4')) {
    const errMsg = checkBooleanFormula(jsonOutput.bool_exp4, true);
    if (errMsg !== '') {
      return `bool_exp4 ${jsonOutput.bool_exp4} is not a valid boolean expression:\n${errMsg}`;
    }
    for (const varName of getVariablesFromFormula(jsonOutput.bool_exp4)) {
      if (!(varName in apDict)) {
        return `bool_exp4: ${varName} is not a valid atomic proposition. ${boolVarMsg}`;
      }
    }
  }
  if (jsonOutput.decision3.includes('N_DURATION') && !checkValidNonnegativeInteger(jsonOutput.N_DURATION)) {
    return `N_DURATION ${jsonOutput.N_DURATION} is not a valid non-zero integer`;
  }
  return null;
}

export function formatRawOutput(rawOutput, apDict) {
  const outputList = [];
  const jsonRawOutput = JSON.parse(rawOutput);
  for (const jsonOutput of jsonRawOutput.translations) {
    try {
      if (
        checkNl2structnlFormatInner(jsonOutput, apDict, null) === null &&
        checkLtlFormula(getLtlFromOutput(jsonOutput))
      ) {
        jsonOutput.output_structured_natural_language = extractStructnlFromOutput(jsonOutput);
        jsonOutput.output_LTL = getLtlFromOutput(jsonOutput);
        outputList.push(jsonOutput);
      }
    } catch (e) {
      console.log(e);
    }
  }
  return outputList;
}

export function getSyntaxUniqueList(outputList) {
  const seen = new Set();
  const res = [];
  for (const output of outputList) {
    if (!seen.has(output.output_structured_natural_language)) {
      res.push(output);
    }
    seen.add(output.output_structured_natural_language);
  }
  return res;
}

export async function getNl2structnlTranslation(
  inputNl,
  apDict,
  { model = 'gpt-4o-mini', maxRetry = 1, k = 1, dcmp = null, prevOutputs = null, mode = null } = {}
) {
  if (mode === null) {
    k = 1;
    prevOutputs = null;
  } else if (mode === 'reflect') {
    k = Math.min(k, 50);
    prevOutputs = getSyntaxUniqueList(prevOutputs);
  } else {
    throw new Error('nl2structnl translation mode not found!');
  }
  const [systemPrompt, userPrompt] = getStructNLPromptSimple(inputNl, apDict, { dcmp, k, prevOutputs });
  const output = await llmPrompt.promptLoop(
    systemPrompt,
    userPrompt,
    model,
    maxRetry,
    checkNl2structnlFormat,
    structuredNLTranslationsSchema,
    { ap_dict: apDict, dcmp }
  );
  if (output !== null) {
    return formatRawOutput(output, apDict);
  } else {
    return [];
  }
}

// Builds the system + user prompt for FRETish structured-NL translation.
// System prompt = init_cmd_str (expert role) + nl_template_str (composition rules)
//                 + structnl_format_str (12-field JSON output schema).
// User prompt   = the NL requirement + atomic_propositions dict serialised as JSON.
// Called by get_nl2structnl_translation() which is invoked from run_llm.js.
// Note: the prompt does NOT explain FRETish grammar; the model is expected to know it.
export function getStructNLPromptSimple(inputNl, apDict, { dcmp = null, prevOutputs = null, k = 10 } = {}) {
  const initCmdStr =
    'You are an expert in Linear Temporal Logic and requirements engineering. Your job is to translate natural language requirements to structured natural language that capture the intents of the requirements.\n';

  let nlTemplateStr = prefixNlTemplateStr;
  nlTemplateStr +=
    '\nThe following lists the ONLY valid options for decision1, decision2, and decision3. You MUST copy one of these strings exactly — do not paraphrase or invent new values:\n';
  nlTemplateStr += decisionOptionsStr;

  let inputStr = '{\n';
  inputStr += `"input_natural_language":"${inputNl}",\n`;
  // ap_dict is loaded by data_loader.load_vars() from Variables.xlsx or PlausibleSpecs.xlsx
  inputStr += `"atomic_propositions":${pyJsonDumps(apDict)},\n`;
  if (dcmp !== null) {
    const invertedDict = {};
    for (const [key, value] of Object.entries(dcmp)) {
      if (!(value in invertedDict)) {
        invertedDict[value] = [];
      }
      invertedDict[value].push(key);
    }
    inputStr += `"nl_substring_to_decision_map":${JSON.stringify(invertedDict)}`;
  }
  inputStr += '}\n';
  let userStrList = [];
  const finalCmdStr = `provide a list of the top ${k} most likely translations (ordered by most likely first to least likely last) in the specified JSON format for the following:\n`;
  userStrList.push(finalCmdStr);
  userStrList.push(inputStr);

  if (prevOutputs !== null && prevOutputs.length > 0) {
    let prevOutputStr =
      'IMPORTANT: You must produce structured natural language different from each in the following list:\n';
    const argList = [
      'decision1',
      'decision2',
      'decision3',
      'bool_exp1',
      'bool_exp2',
      'bool_exp3',
      'bool_exp4',
      'N_DURATION',
    ];
    prevOutputStr += pyJsonDumps(
      prevOutputs.map((e) => {
        const obj = {};
        for (const k2 of argList) obj[k2] = e[k2];
        return obj;
      })
    );
    prevOutputStr +=
      '\nThe above are incorrect. Please produce translations to structured natural language that could capture the meaning of the input_natural_langauge.';
    userStrList = [prevOutputStr, ...userStrList];
  }

  let systemPrompt;
  if (dcmp === null) {
    systemPrompt = [initCmdStr, nlTemplateStr, structnlFormatStr, structnlExampleStr, structnlSchemaStr].join('\n');
  } else {
    systemPrompt = [initCmdStr, nlTemplateStr, structnlDcmpFormatStr, structnlExampleStr, structnlSchemaStr].join(
      '\n'
    );
  }
  const userPrompt = userStrList.join('\n');
  return [systemPrompt, userPrompt];
}

export function getStructnlToLtlTemplate(decision1, decision2, decision3) {
  const curStructnl = decision1.replace('_ABSTRACT_VAR1_', decision2.replace('_ABSTRACT_VAR2_', decision3));
  return getStructnlToLtlDict()[curStructnl];
}

export function getLtlFromOutput(output, ltlTemplate = null) {
  if (ltlTemplate === null) {
    ltlTemplate = getStructnlToLtlTemplate(output.decision1, output.decision2, output.decision3);
  }
  for (const [, itemList] of Object.entries(decisionToItemList)) {
    for (const k of itemList) {
      if (k in output && output[k] !== null && output[k] !== undefined && ltlTemplate.includes(k)) {
        if (k !== 'N_DURATION') {
          let curExp = parenthesize(output[k]);
          if (curExp === '1') {
            curExp = 'TRUE';
          } else if (curExp === '0') {
            curExp = 'FALSE';
          }
          ltlTemplate = ltlTemplate.split(k).join(`(${curExp})`);
        } else {
          ltlTemplate = ltlTemplate
            .split('N_DURATION+1')
            .join(String(parseInt(output[k], 10) + 1));
          ltlTemplate = ltlTemplate
            .split('N_DURATION-1')
            .join(String(parseInt(output[k], 10) - 1));
          ltlTemplate = ltlTemplate.split('N_DURATION').join(String(output[k]));
        }
      }
    }
  }
  return ltlTemplate;
}

// Replaces `spot.formula(...).to_str(parenth=True)` with the pure-JS `parenthesize` helper.
export function getLtlFromOptions(optionDict) {
  let res = getStructnlToLtlTemplate(
    optionDict.decision1.option,
    optionDict.decision2.option,
    optionDict.decision3.option
  );
  for (const [decision, itemList] of Object.entries(decisionToItemList)) {
    for (const k of itemList) {
      if (k in optionDict[decision] && optionDict[decision][k] !== null && optionDict[decision][k] !== undefined && res.includes(k)) {
        if (k !== 'N_DURATION') {
          let curExp = parenthesize(optionDict[decision][k]);
          if (curExp === '1') {
            curExp = 'TRUE';
          } else if (curExp === '0') {
            curExp = 'FALSE';
          }
          res = res.split(k).join(`(${curExp})`);
        } else {
          res = res.split('N_DURATION+1').join(String(parseInt(optionDict[decision][k], 10) + 1));
          res = res.split('N_DURATION-1').join(String(parseInt(optionDict[decision][k], 10) - 1));
          res = res.split('N_DURATION').join(String(optionDict[decision][k]));
        }
      }
    }
  }
  return res;
}

export function getAllPossibleDecisionOptionsForEx(output, MAX_DURATION = 5) {
  const keyList = ['bool_exp1', 'bool_exp2', 'bool_exp3', 'bool_exp4'];
  const allBools = [];
  const curApDict = {};
  for (const k of keyList) {
    if (k in output && output[k] !== null && output[k] !== undefined && checkBooleanFormula(output[k])) {
      allBools.push(output[k]);
      for (const varName of getVariablesFromFormula(output[k])) {
        curApDict[varName] = varName;
      }
    } else {
      allBools.push(null);
    }
  }
  let durationList;
  if (output.decision3.includes('N_DURATION') && checkValidNonnegativeInteger(output.N_DURATION)) {
    durationList = [output.N_DURATION];
  } else {
    durationList = [];
    for (let n = 1; n <= MAX_DURATION; n++) durationList.push(n);
  }

  const newOutputList = [];
  const curBool = allBools;
  for (const nDuration of durationList) {
    for (const d1 of decision1Options) {
      for (const d2 of decision2Options) {
        for (const d3 of decision3Options) {
          const newOutput = { ...output };
          newOutput.bool_exp1 = curBool[0];
          newOutput.bool_exp2 = curBool[1];
          newOutput.bool_exp3 = curBool[2];
          newOutput.bool_exp4 = curBool[3];
          newOutput.decision1 = d1;
          newOutput.decision2 = d2;
          newOutput.decision3 = d3;
          newOutput.N_DURATION = nDuration;
          if (checkNl2structnlFormatInner(newOutput, curApDict) === null) {
            newOutputList.push(newOutput);
          }
        }
      }
    }
  }
  return newOutputList;
}
