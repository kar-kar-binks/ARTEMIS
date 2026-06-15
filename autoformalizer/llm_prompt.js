const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 1_800_000;

// Strip markdown code fences that some models emit even in JSON mode.
function stripJsonMarkdown(s) {
  if (!s) return s;
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return m ? m[1] : s.trim();
}

// Single POST to Ollama's /chat/completions. Returns the content string.
// messages: [{role, content: string}, ...]
export async function ollamaChat(messages, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return stripJsonMarkdown(data.choices[0]?.message?.content ?? '');
}

// Inline all $defs/$ref entries so the schema is fully explicit with no references.
export function resolveSchemaRefs(schema) {
  const defs = schema.$defs || {};
  function resolve(obj) {
    if (Array.isArray(obj)) return obj.map((item) => resolve(item));
    if (obj !== null && typeof obj === 'object') {
      if ('$ref' in obj) {
        const refName = obj.$ref.split('/').pop();
        return resolve(defs[refName] !== undefined ? defs[refName] : obj);
      }
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k !== '$defs') result[k] = resolve(v);
      }
      return result;
    }
    return obj;
  }
  return resolve(schema);
}

// localMessages: [{role: "system"|"user"|"assistant", text: string}]
// Converts to [{role, content: string}] for the Ollama API.
function toApiMessages(localMessages) {
  return localMessages.map((m) => ({ role: m.role, content: m.text }));
}

export async function queryOllama(localMessages, _schema = null, model = 'llama3.2', maxEmptyRetry = 2) {
  let raw = '';
  for (let attempt = 0; attempt <= maxEmptyRetry; attempt++) {
    process.stderr.write(`Querying Ollama (model=${model})...\n`);
    raw = await ollamaChat(toApiMessages(localMessages), model);
    if (raw) break;
    process.stderr.write(
      `query_ollama: empty response (attempt ${attempt + 1}/${maxEmptyRetry + 1})\n`
    );
  }
  return raw;
}

export async function getFormalizationsLoop(
  inputNl,
  apDict,
  translationFunc,
  numTrial = 5,
  model = 'llama3.2',
  prevOutputs = null,
  maxEmptyAttempts = 5,
  kwargs = {}
) {
  if (prevOutputs === null) prevOutputs = [];
  let emptyAttempts = 0;
  while (prevOutputs.length < numTrial) {
    const curOutput = await translationFunc(inputNl, apDict, {
      model,
      maxRetry: 3,
      prevOutputs,
      k: numTrial,
      ...kwargs,
    });
    if (curOutput.length === 0) {
      emptyAttempts += 1;
      if (emptyAttempts >= maxEmptyAttempts) {
        process.stderr.write(`get_formalizations_loop: giving up after ${emptyAttempts} empty attempts.\n`);
        break;
      }
      continue;
    }
    emptyAttempts = 0;
    prevOutputs.push(...curOutput);
  }
  return prevOutputs.slice(0, numTrial);
}

export async function promptLoop(systemPrompt, userPrompt, model, maxRetry, checkOutputFunc, _schema, kwargs = {}) {
  const localMessages = [
    { role: 'system', text: systemPrompt },
    { role: 'user', text: userPrompt },
  ];
  let rawOutput;
  for (let trial = 0; trial < maxRetry; trial++) {
    rawOutput = await queryOllama(localMessages, null, model);
    const errorMsg = checkOutputFunc(rawOutput, kwargs);
    if (errorMsg === null) break;
    process.stderr.write(`error msg: ${errorMsg}\n`);
    localMessages.push({ role: 'assistant', text: rawOutput });
    localMessages.push({ role: 'user', text: errorMsg });
  }
  try {
    JSON.parse(rawOutput);
    return rawOutput;
  } catch {
    return null;
  }
}
