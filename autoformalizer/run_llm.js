// JS port of run_llm.ipynb's executed code cells.
//
// This script prompts an LLM (via Ollama) to translate NL requirements to structured
// NL / FRETish, for the configured benchmark dataset(s) and model(s).
//
// To run: `node run_llm.js`

import { writeFileSync } from 'fs';
import XLSX from 'xlsx';
import * as dataLoader from './data_loader.js';
import * as llmPrompt from './llm_prompt.js';
import * as nl2structnl from './nl2structnl.js';

process.env.STRUCTNL_MODE = 'fretish'; // or "PSP"
// No config needed, since we're using Ollama
// process.env.GEMINI_API_KEY = "TODO"
// process.env.OPENAI_API_KEY = "TODO"
// Optionally override Ollama URL (default: http://127.0.0.1:11434/v1)
// process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1"

process.env.DATA_HOME_DIR = './metadata';

const dataHomeDir = process.env.STRUCTNL_MODE === 'fretish' ? './benchmarks/fret_specs/' : './benchmarks/psp_specs/';

// select the list of benchmarks
// const datasetList = ["Ventilator","FSM-AP","FSM-S","REG","RobotExplain","deepstl-test"];
// const datasetList = ["Thales"];
const datasetList = ['FSM-S'];

// select model and number of candidates to generate per requirement
const numTrial = 1;
const modelList = ['qwen2.5:32b'];
// const modelList = ["gemini-2.5-flash"];
// const modelList = ["gpt-4.1"];

// Set true to always generate atomic propositions via Ollama (ignores Variables.xlsx).
// Set false to only generate when Variables.xlsx is not present.
const ALWAYS_GENERATE_VARIABLES = true;

// specify directory to save results
const saveDir = './ollama_outputs';

// specify prompting approach, currently configured to use ARTEMIS "nl2structnl"
const allMethods = ['nl2structnl', 'nl2ltl', 'nl2spec', 'NL2TL', 'NL2TL-FT', 'deepstl', 'nl2ltltemplate', 'synthtl'];
const curMethods = ['nl2structnl'];
console.log(curMethods);

function readPlausibleSpecs(curDatasetName) {
  const curDfFile = dataHomeDir + curDatasetName + '/PlausibleSpecs.xlsx';
  const workbook = XLSX.readFile(curDfFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

async function runSingleTask(curDatasetName, model, rowIdx, curMethod) {
  const df = readPlausibleSpecs(curDatasetName);
  let curExpName = `${saveDir}/${curDatasetName}-${rowIdx}_model-${model}_trials-${numTrial}`;
  if (rowIdx < df.length) {
    console.log('row_idx:', curDatasetName, rowIdx, model, curMethod);
    let isDone = false;
    let outputs;
    while (!isDone) {
      const prevOutputs = [];
      const inputNl = df[rowIdx]['NL'];
      console.log('input:');
      console.log(inputNl);
      const [apDict, ollamaApOutput] = await dataLoader.loadVars(dataHomeDir, curDatasetName, {
        rowIdx,
        alwaysGenerate: ALWAYS_GENERATE_VARIABLES,
        model,
      });
      if (ollamaApOutput !== null) {
        console.log('Ollama-generated atomic propositions (used for formalization):');
        console.log(ollamaApOutput);
      }
      console.log('Atomic propositions used:');
      console.log(apDict);
      if (curMethod === 'nl2structnl') {
        outputs = await llmPrompt.getFormalizationsLoop(
          inputNl,
          apDict,
          (nl, ap, kwargs) => nl2structnl.getNl2structnlTranslation(nl, ap, kwargs),
          numTrial,
          model,
          prevOutputs
        );
      } else {
        throw new Error(`Unknown method: ${curMethod}`);
      }
      curExpName = `${saveDir}/${curDatasetName}-${rowIdx}_model-${model}_trials-${numTrial}`;
      writeFileSync(`${curExpName}_${curMethod}.json`, JSON.stringify(outputs));
      console.log(rowIdx, curMethod, 'done!', 'num outputs:', outputs.length);
      isDone = true;
    }
    return outputs;
  }
  return undefined;
}

async function main() {
  const rowIdxRange = null;

  const tasks = [];
  for (const curDatasetName of datasetList) {
    for (const model of modelList) {
      for (const method of curMethods) {
        const df = readPlausibleSpecs(curDatasetName);
        for (let rowIdx = 0; rowIdx < df.length; rowIdx++) {
          if (rowIdxRange === null || rowIdxRange.includes(rowIdx)) {
            tasks.push([curDatasetName, model, rowIdx, method]);
          }
        }
      }
    }
  }

  // run the LLM on each requirement in the benchmarks
  for (const [curDatasetName, model, rowIdx, curMethod] of tasks) {
    const outputs = await runSingleTask(curDatasetName, model, rowIdx, curMethod);
    console.log('output:');
    console.log(outputs);
    // remove break after testing a single run, to process entire dataset
    break;
  }
}

main();
