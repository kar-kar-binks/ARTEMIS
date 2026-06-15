// Lightweight smoke/unit tests for the ARTEMIS JS port.
//
// These tests only exercise pure-JS logic (string/template processing, schema
// validation, Excel loading, formula construction) that does not require a
// running Ollama server or a NuSMV/nuXmv binary. To run:
//
//   node test.js
//
// See README.md for how to run the full pipeline (which does need Ollama and
// optionally NuSMV).

process.env.STRUCTNL_MODE = 'fretish';
process.env.DATA_HOME_DIR = './metadata';

import assert from 'node:assert/strict';
import * as spotUtils from './spot_utils.js';
import * as nusmvUtils from './nusmv_utils.js';
import * as nl2structnlFretish from './nl2structnl_fretish.js';
import * as dataLoader from './data_loader.js';
import { validateAPList, validateStructuredNLTranslations } from './fretish_llm_output_schema.js';
import { toSmvBatchJobList, parseNusmvBatchResults } from './batch_check.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok   - ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL - ${name}`);
    console.log(`       ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// spot_utils.js
// ---------------------------------------------------------------------------

test('checkBooleanFormula: accepts plain boolean expressions', () => {
  assert.equal(spotUtils.checkBooleanFormula('a & (b | !c)'), true);
});

test('checkBooleanFormula: rejects LTL/temporal operators', () => {
  assert.equal(spotUtils.checkBooleanFormula('G a'), false);
});

test('checkBooleanFormula: rejects unbalanced parentheses', () => {
  assert.equal(spotUtils.checkBooleanFormula('(a & b'), false);
});

test('getVariablesFromFormula: extracts unique variable names in order', () => {
  assert.deepEqual(spotUtils.getVariablesFromFormula('a & (b | !a) & c'), ['a', 'b', 'c']);
});

test('checkLtlFormula: accepts formulas with LTL operators', () => {
  assert.equal(spotUtils.checkLtlFormula('G (a -> F b)'), true);
});

test('parenthesize: wraps in parens', () => {
  assert.equal(spotUtils.parenthesize('a & b'), '(a & b)');
});

test('filterLtlFormula: normalizes 1/0 to TRUE/FALSE and wraps', () => {
  assert.equal(spotUtils.filterLtlFormula('a & 1'), '(a & TRUE)');
  assert.equal(spotUtils.filterLtlFormula('a & 0'), '(a & FALSE)');
});

test('checkValidNonnegativeInteger', () => {
  assert.equal(spotUtils.checkValidNonnegativeInteger('3'), true);
  assert.equal(spotUtils.checkValidNonnegativeInteger('0'), false);
  assert.equal(spotUtils.checkValidNonnegativeInteger('-1'), false);
  assert.equal(spotUtils.checkValidNonnegativeInteger('abc'), false);
});

// ---------------------------------------------------------------------------
// fretish_llm_output_schema.js
// ---------------------------------------------------------------------------

test('validateAPList: accepts a well-formed atomic-propositions list', () => {
  const obj = {
    atomic_propositions: [
      { variable_name: 'trigger_condition', description: 'desc1' },
      { variable_name: 'target_state', description: 'desc2' },
    ],
  };
  assert.equal(validateAPList(obj), null);
});

test('validateAPList: rejects missing fields', () => {
  const err = validateAPList({ atomic_propositions: [{ variable_name: 'x' }] });
  assert.notEqual(err, null);
});

test('validateStructuredNLTranslations: accepts a well-formed translation', () => {
  const obj = {
    translations: [
      {
        decision1: 'whenever bool_exp1, _ABSTRACT_VAR1_',
        bool_exp1: 'trigger_condition',
        decision2: '_ABSTRACT_VAR2_',
        bool_exp2: null,
        decision3: 'immediately satisfy bool_exp3',
        bool_exp3: 'target_state',
        bool_exp4: null,
        N_DURATION: null,
        explanation: 'because the trigger condition implies the target state',
        decision1_substring: 'whenever the trigger condition occurs',
        decision2_substring: '',
        decision3_substring: 'the target state is immediately satisfied',
      },
    ],
  };
  assert.equal(validateStructuredNLTranslations(obj), null);
});

// ---------------------------------------------------------------------------
// nl2structnl_fretish.js
// ---------------------------------------------------------------------------

const sampleOutput = {
  decision1: 'whenever bool_exp1, _ABSTRACT_VAR1_',
  bool_exp1: 'trigger_condition',
  decision2: '_ABSTRACT_VAR2_',
  bool_exp2: null,
  decision3: 'immediately satisfy bool_exp3',
  bool_exp3: 'target_state',
  bool_exp4: null,
  N_DURATION: null,
};

test('extractStructnlFromOutput: substitutes bool expressions into the template', () => {
  const structnl = nl2structnlFretish.extractStructnlFromOutput(sampleOutput);
  assert.equal(structnl, 'whenever trigger_condition, immediately satisfy target_state');
});

test('checkNl2structnlFormatInner: accepts a valid output', () => {
  const apDict = { trigger_condition: 'desc1', target_state: 'desc2' };
  assert.equal(nl2structnlFretish.checkNl2structnlFormatInner(sampleOutput, apDict), null);
});

test('checkNl2structnlFormatInner: rejects invalid decision1', () => {
  const apDict = { trigger_condition: 'desc1', target_state: 'desc2' };
  const bad = { ...sampleOutput, decision1: 'not a valid option' };
  assert.notEqual(nl2structnlFretish.checkNl2structnlFormatInner(bad, apDict), null);
});

test('checkNl2structnlFormatInner: rejects unknown atomic propositions', () => {
  const apDict = { target_state: 'desc2' };
  assert.notEqual(nl2structnlFretish.checkNl2structnlFormatInner(sampleOutput, apDict), null);
});

test('getLtlFromOutput: builds an LTL formula from the structured-NL template', () => {
  const ltl = nl2structnlFretish.getLtlFromOutput(sampleOutput);
  assert.equal(spotUtils.checkLtlFormula(ltl), true);
  assert.match(ltl, /trigger_condition/);
  assert.match(ltl, /target_state/);
});

test('getStructNLPromptSimple: serializes atomic_propositions like Python json.dumps', () => {
  const apDict = { trigger_condition: 'desc1', target_state: 'desc2' };
  const [, userPrompt] = nl2structnlFretish.getStructNLPromptSimple('test requirement', apDict, {});
  assert.match(
    userPrompt,
    /"atomic_propositions":\{"trigger_condition": "desc1", "target_state": "desc2"\}/
  );
});

// ---------------------------------------------------------------------------
// data_loader.js
// ---------------------------------------------------------------------------

test('extractOptionsForGroup: computes the cartesian product of per-decision options', () => {
  const optionsPerGroup = [
    { decision1: ['a', 'b'], decision2: ['x'] },
  ];
  const res = dataLoader.extractOptionsForGroup(optionsPerGroup, 0);
  assert.deepEqual(res, [
    { decision1: 'a', decision2: 'x' },
    { decision1: 'b', decision2: 'x' },
  ]);
});

test('getApDict: builds a {name: description} dict from Variables.xlsx rows', () => {
  const varDf = [
    { 'variable name': 'foo', description: 'foo desc' },
    { 'variable name': 'bar', description: 'bar desc' },
  ];
  assert.deepEqual(dataLoader.getApDict(varDf), { foo: 'foo desc', bar: 'bar desc' });
});

// ---------------------------------------------------------------------------
// nusmv_utils.js (pure string/regex logic, no nuXmv binary required)
// ---------------------------------------------------------------------------

test('detectCounterexample: detects "Trace Type: Counterexample"', () => {
  assert.equal(nusmvUtils.detectCounterexample('-- specification foo is false\nTrace Type: Counterexample'), true);
  assert.equal(nusmvUtils.detectCounterexample('-- specification foo is true'), false);
});

test('checkValidNusmvFormula: rejects unbalanced parentheses without invoking NuSMV', () => {
  const res = nusmvUtils.checkValidNusmvFormula({ a: 'boolean' }, '(a & b', true);
  assert.notEqual(res, true);
});

// ---------------------------------------------------------------------------
// batch_check.js
// ---------------------------------------------------------------------------

test('toSmvBatchJobList: builds NuSMV check formulas for equivalence/subset/superset/overlap', () => {
  const [varDict, formulas] = toSmvBatchJobList([
    ['equivalence', ['a', 'b']],
    ['subset', ['a', 'b']],
    ['superset', ['a', 'b']],
    ['overlap', ['a', 'b']],
  ]);
  assert.deepEqual(varDict, { a: 'boolean', b: 'boolean' });
  assert.equal(formulas.length, 4);
  for (const f of formulas) assert.equal(spotUtils.checkLtlFormula(f), true);
});

test('parseNusmvBatchResults: maps "-- specification ... is true/false" lines to booleans', () => {
  const rawOut = [
    '-- specification (a) <-> (b) is true',
    '-- specification (a) is false',
  ].join('\n');
  const res = parseNusmvBatchResults(rawOut, ['(a) <-> (b)', '(a)'], null);
  assert.deepEqual(res, [true, false]);
});

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
