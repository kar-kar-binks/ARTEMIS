import OpenAI from 'openai';
import { apListSchema, validateAPList } from './fretish_llm_output_schema.js';

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

function checkApOutput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return `Invalid format: ${e}`;
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
      `The following variable names are not valid identifiers: ${JSON.stringify(bad)}. ` +
      'Variable names must start with a letter and contain only letters, digits, and underscores.'
    );
  }
  const reserved = parsed.atomic_propositions
    .filter((ap) => FRET_RESERVED_WORDS.has(ap.variable_name.toLowerCase()))
    .map((ap) => ap.variable_name);
  if (reserved.length > 0) {
    return (
      `The following variable names are reserved words in the FRET requirements grammar ` +
      `and cannot be used: ${JSON.stringify(reserved)}. Please choose different variable names.`
    );
  }
  return null;
}

// Generate atomic propositions (variable name + description) for a single NL requirement.
// Returns {variable_name: description} or null on failure.
export async function generateApDict(nlText, { model = 'qwen2.5:32b', maxRetry = 3 } = {}) {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
  const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 1_800_000;
  const client = new OpenAI({ baseURL: ollamaBaseUrl, apiKey: 'ollama', timeout: ollamaTimeoutMs });

  const systemPrompt =
    'You are an expert in requirements engineering and formal specification. ' +
    'Given a natural language requirement, identify all atomic boolean propositions ' +
    '(system state variables) needed to express it formally as a FRETish requirement. ' +
    'For each proposition provide a variable name and a brief description. ' +
    'Variable names must start with a letter and contain only letters, digits, and underscores, ' +
    "and must not be one of FRET's reserved words (e.g. shall, when, if, mode, and, or, not, " +
    'true, false, until, within). Use lowercase snake_case names (e.g. "sensor_is_active"). ' +
    'For FSM states use the pattern "state_is_<MODE_NAME>" (e.g. "state_is_NOMINAL"). ' +
    'If the requirement contains a hint in parentheses like "limits are exceeded (limits)", ' +
    'use that hint as the variable_name verbatim. ' +
    'Respond with a single JSON object only, no extra text or markdown fences:\n' +
    '{"atomic_propositions": [{"variable_name": "limits", "description": "True when limits are exceeded"}]}';

  const messages = [
    { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
    { role: 'user', content: [{ type: 'text', text: `Generate atomic propositions for:\n${nlText}` }] },
  ];

  let raw = null;
  for (let trial = 0; trial < maxRetry; trial++) {
    process.stderr.write(`Querying Ollama for atomic propositions (attempt ${trial + 1}/${maxRetry})...\n`);
    const response = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
    });
    raw = (response.choices[0].message.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const errorMsg = checkApOutput(raw);
    if (errorMsg === null) break;
    process.stderr.write(`AP error: ${errorMsg}\n`);
    messages.push({ role: 'assistant', content: [{ type: 'text', text: raw }] });
    messages.push({ role: 'user', content: [{ type: 'text', text: errorMsg }] });
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
