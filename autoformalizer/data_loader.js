import { apListSchema, validateAPList } from './fretish_llm_output_schema.js';
import { ollamaChat } from './llm_prompt.js';

// Identifiers must follow the FRET grammar's ID rule.
const AP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

// Words reserved by the FRET requirements grammar.
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

// Reject negation-named APs like not_X, no_X — these should be !X in bool_exp.
const NEGATION_NAME_RE = /^(not|no)_/i;

function checkApOutput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return `Invalid JSON: ${e.message}`;
  }
  const validationErr = validateAPList(parsed);
  if (validationErr !== null) return validationErr;
  if (parsed.atomic_propositions.length === 0) {
    return 'No atomic propositions were generated. Please generate at least one.';
  }
  const bad = parsed.atomic_propositions
    .filter((ap) => !AP_ID_RE.test(ap.variable_name))
    .map((ap) => ap.variable_name);
  if (bad.length > 0) {
    return (
      `Invalid identifier(s): ${JSON.stringify(bad)}. ` +
      'Names must start with a letter and contain only letters, digits, and underscores.'
    );
  }
  const negated = parsed.atomic_propositions
    .filter((ap) => NEGATION_NAME_RE.test(ap.variable_name))
    .map((ap) => ap.variable_name);
  if (negated.length > 0) {
    return (
      `Do not create negation-named variables ${JSON.stringify(negated)}. ` +
      'Use the positive variable (e.g. "request") and negate it with ! in the bool_exp field (e.g. "!request").'
    );
  }
  const reserved = parsed.atomic_propositions
    .filter((ap) => FRET_RESERVED_WORDS.has(ap.variable_name.toLowerCase()))
    .map((ap) => ap.variable_name);
  if (reserved.length > 0) {
    return (
      `Reserved word(s) cannot be used as variable names: ${JSON.stringify(reserved)}. ` +
      'Please choose different variable names.'
    );
  }
  return null;
}

const AP_SYSTEM_PROMPT =
  'You are an expert in requirements engineering and formal specification. ' +
  'Given a natural language requirement, identify all atomic boolean propositions ' +
  '(system state variables) needed to express it formally as a FRETish requirement. ' +
  '\n\nNAMING RULES (all are mandatory):' +
  '\n1. Names must start with a letter and contain only letters, digits, and underscores.' +
  '\n2. Must not be a FRET reserved word (shall, when, if, mode, and, or, not, true, false, until, within, etc.).' +
  '\n3. Use lowercase snake_case for ordinary variables (e.g. "sensor_active", "limits").' +
  '\n4. For FSM states ALWAYS use "state_is_<MODENAME>" with the mode name in UPPERCASE ' +
  '(e.g. "state_is_NOMINAL", "state_is_FAULT", "state_is_TRANSITION"). Never use lowercase for mode names.' +
  '\n5. NEVER create variables like "not_X", "no_X", or "X_not" to represent negation. ' +
  'Instead, define the positive variable (e.g. "request") and use "!request" as a boolean expression ' +
  'in the formalization. Negation is expressed with the ! operator, not by naming.' +
  '\n6. If the requirement hints at a variable name in parentheses (e.g. "limits are exceeded (limits)"), ' +
  'use that exact name.' +
  '\n\nFor state-transition requirements ("shall change from STATE_A to STATE_B when CONDITION"), ' +
  'always include BOTH the source state (state_is_STATE_A) and target state (state_is_STATE_B) as separate APs, ' +
  'plus an AP for the condition.' +
  '\n\nGenerate one entry per distinct concept. ' +
  'Respond with a single JSON object only, no extra text or markdown fences:\n' +
  '{"atomic_propositions": [{"variable_name": "limits", "description": "True when limits are exceeded"}]}';

// Generate atomic propositions for a single NL requirement.
// Returns {variable_name: description} or null on failure.
export async function generateApDict(nlText, { model = 'qwen2.5:32b', maxRetry = 3 } = {}) {
  const messages = [
    { role: 'system', content: AP_SYSTEM_PROMPT },
    { role: 'user', content: `Generate atomic propositions for:\n${nlText}` },
  ];

  let raw = null;
  for (let trial = 0; trial < maxRetry; trial++) {
    process.stderr.write(`Querying Ollama for atomic propositions (attempt ${trial + 1}/${maxRetry})...\n`);
    raw = await ollamaChat(messages, model);
    const errorMsg = checkApOutput(raw);
    if (errorMsg === null) break;
    process.stderr.write(`AP error: ${errorMsg}\n`);
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: errorMsg });
  }

  try {
    const parsed = JSON.parse(raw);
    if (validateAPList(parsed) === null) {
      const apDict = {};
      for (const ap of parsed.atomic_propositions) apDict[ap.variable_name] = ap.description;
      return apDict;
    }
  } catch {}
  return null;
}
