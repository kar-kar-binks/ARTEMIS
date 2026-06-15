// Ollama NL-to-LTL CLI.
//
// Usage: node run_llm.js
// Then type (or paste) a natural language requirement and press Enter.
// The FRETish structured NL and LTL formula are printed to stdout.

import { createInterface } from 'readline';
import { generateApDict } from './data_loader.js';
import { getNl2structnlTranslation } from './nl2structnl.js';

const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:32b';

async function translate(nl) {
  process.stderr.write('Generating atomic propositions...\n');
  const apDict = await generateApDict(nl, { model: MODEL });
  if (!apDict) {
    console.error('Failed to generate atomic propositions. Is Ollama running?');
    return;
  }

  process.stderr.write('Translating to FRETish/LTL...\n');
  const outputs = await getNl2structnlTranslation(nl, apDict, { model: MODEL, maxRetry: 5, k: 1 });

  if (!outputs || outputs.length === 0) {
    console.error('No valid LTL output produced.');
    return;
  }

  const best = outputs[0];
  console.log('\nStructured NL:', best.output_structured_natural_language);
  console.log('LTL:          ', best.output_LTL);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter NL requirement: ', async (nl) => {
  rl.close();
  nl = nl.trim();
  if (!nl) {
    console.error('No input provided.');
    process.exit(1);
  }
  await translate(nl);
});
