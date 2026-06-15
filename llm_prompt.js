// JS port of llm_prompt.py.

import OpenAI from 'openai';

// Ollama client uses the OpenAI-compatible REST API that Ollama exposes at port 11434.
// Override OLLAMA_BASE_URL env var to point at a remote Ollama instance if needed.
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const ollamaClient = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: 'ollama' });

// localMessages: list of {role: "system"|"user"|"assistant", text: str}

export function formatLocalmessagesToOpenai(localMessages) {
  return localMessages.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.text }],
  }));
}

// Inline all $defs/$ref entries so the schema is fully explicit with no references.
export function resolveSchemaRefs(schema) {
  const defs = schema.$defs || {};
  function resolve(obj) {
    if (Array.isArray(obj)) {
      return obj.map((item) => resolve(item));
    }
    if (obj !== null && typeof obj === 'object') {
      if ('$ref' in obj) {
        const refName = obj.$ref.split('/').pop();
        return resolve(defs[refName] !== undefined ? defs[refName] : obj);
      }
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k !== '$defs') {
          result[k] = resolve(v);
        }
      }
      return result;
    }
    return obj;
  }
  return resolve(schema);
}

// Sends a prompt to a locally-running Ollama model via its OpenAI-compatible endpoint.
// Uses Ollama's native structured output (json_schema response_format) which applies
// constrained grammar decoding to guarantee the output matches the schema exactly.
export async function queryOllama(localMessages, schema = null, model = 'llama3.2', maxEmptyRetry = 2) {
  const messages = formatLocalmessagesToOpenai(localMessages);
  let responseFormat;
  if (schema !== null) {
    const schemaJson = resolveSchemaRefs(schema);
    responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'output',
        strict: true,
        schema: schemaJson,
      },
    };
  } else {
    responseFormat = { type: 'json_object' };
  }
  let raw = '';
  for (let attempt = 0; attempt <= maxEmptyRetry; attempt++) {
    const response = await ollamaClient.chat.completions.create({
      model,
      messages,
      response_format: responseFormat,
    });
    raw = response.choices[0].message.content;
    if (raw) {
      break;
    }
    console.log(
      `query_ollama: empty response from Ollama (attempt ${attempt + 1}/${maxEmptyRetry + 1}). ` +
        `finish_reason=${JSON.stringify(response.choices[0].finish_reason)}`
    );
  }
  return raw;
}

export async function getFormalizationsLoop(
  inputNl,
  apDict,
  translationFunc,
  numTrial = 5,
  model = 'gpt-4o-mini',
  prevOutputs = null,
  maxEmptyAttempts = 5,
  kwargs = {}
) {
  if (prevOutputs === null) {
    prevOutputs = [];
  }
  let curSet = new Set(prevOutputs.map((output) => output.output_LTL));
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
        console.log(`get_formalizations_loop: giving up after ${emptyAttempts} attempts with no valid output.`);
        break;
      }
      continue;
    }
    emptyAttempts = 0;
    const newSet = new Set(curOutput.map((output) => output.output_LTL));
    prevOutputs.push(...curOutput);
    for (const v of newSet) {
      curSet.add(v);
    }
  }
  return prevOutputs.slice(0, numTrial);
}

export async function promptLoop(systemPrompt, userPrompt, model, maxRetry, checkOutputFunc, schema, kwargs = {}) {
  // All model names are routed to Ollama (local inference) via its
  // OpenAI-compatible endpoint, e.g. "qwen2.5:32b".
  const localMessages = [
    { role: 'system', text: systemPrompt },
    { role: 'user', text: userPrompt },
  ];
  let rawOutput;
  for (let trial = 0; trial < maxRetry; trial++) {
    rawOutput = await queryOllama(localMessages, schema, model);
    const errorMsg = checkOutputFunc(rawOutput, kwargs);
    if (errorMsg === null) {
      break;
    } else {
      console.log('error msg:', errorMsg);
      localMessages.push({ role: 'assistant', text: rawOutput });
      localMessages.push({ role: 'user', text: errorMsg });
    }
  }
  let isValidJson;
  try {
    JSON.parse(rawOutput);
    isValidJson = true;
  } catch {
    isValidJson = false;
  }
  if (isValidJson) {
    return rawOutput;
  } else {
    return null;
  }
}
