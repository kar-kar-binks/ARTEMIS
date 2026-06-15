// JS port of fretish_llm_output_schema.py.
//
// The Python pydantic BaseModel classes serve two purposes:
//   1. produce a JSON Schema for Ollama's structured-output `response_format`
//      (via `model.model_json_schema()`, with `$defs`/`$ref` inlined by
//      `llm_prompt._resolve_schema_refs`)
//   2. validate raw LLM JSON output (via `Model(**json_output)`)
//
// Here each "model" is represented as a plain, already-inlined JSON Schema object
// (mirroring the output of `_resolve_schema_refs(model.model_json_schema())`), plus
// a small validation function for (2).

const DECISION1_OPTIONS = [
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

const DECISION2_OPTIONS = [
  'whenever bool_exp2, _ABSTRACT_VAR2_',
  'upon bool_exp2, _ABSTRACT_VAR2_',
  '_ABSTRACT_VAR2_',
];

const DECISION3_OPTIONS = [
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

// --- StructuredNLResult / StructuredNLTranslations -------------------------

const structuredNLResultProperties = {
  explanation: { title: 'Explanation', type: 'string' },
  decision1: { title: 'Decision1', enum: DECISION1_OPTIONS, type: 'string' },
  bool_exp1: { title: 'Bool Exp1', type: 'string' },
  decision2: { title: 'Decision2', enum: DECISION2_OPTIONS, type: 'string' },
  bool_exp2: { title: 'Bool Exp2', type: 'string' },
  decision3: { title: 'Decision3', enum: DECISION3_OPTIONS, type: 'string' },
  bool_exp3: { title: 'Bool Exp3', type: 'string' },
  bool_exp4: { title: 'Bool Exp4', type: 'string' },
  N_DURATION: { title: 'N Duration', anyOf: [{ type: 'integer' }, { type: 'null' }] },
  decision1_substring: { title: 'Decision1 Substring', type: 'string' },
  decision2_substring: { title: 'Decision2 Substring', type: 'string' },
  decision3_substring: { title: 'Decision3 Substring', type: 'string' },
};

export const structuredNLResultSchema = {
  title: 'StructuredNLResult',
  type: 'object',
  properties: structuredNLResultProperties,
  required: Object.keys(structuredNLResultProperties),
  additionalProperties: false,
};

export const structuredNLTranslationsSchema = {
  title: 'StructuredNLTranslations',
  type: 'object',
  properties: {
    translations: { title: 'Translations', type: 'array', items: structuredNLResultSchema },
  },
  required: ['translations'],
  additionalProperties: false,
};

// --- LTLTemplateResult / LTLTemplateTranslations ---------------------------

const ltlTemplateResultProperties = {
  explanation: { title: 'Explanation', type: 'string' },
  chosen_template_ID: { title: 'Chosen Template Id', type: 'integer' },
  bool_exp1: { title: 'Bool Exp1', type: 'string' },
  bool_exp2: { title: 'Bool Exp2', type: 'string' },
  bool_exp3: { title: 'Bool Exp3', type: 'string' },
  bool_exp4: { title: 'Bool Exp4', type: 'string' },
  N_DURATION: { title: 'N Duration', anyOf: [{ type: 'integer' }, { type: 'null' }] },
};

export const ltlTemplateResultSchema = {
  title: 'LTLTemplateResult',
  type: 'object',
  properties: ltlTemplateResultProperties,
  required: Object.keys(ltlTemplateResultProperties),
  additionalProperties: false,
};

export const ltlTemplateTranslationsSchema = {
  title: 'LTLTemplateTranslations',
  type: 'object',
  properties: {
    translations: { title: 'Translations', type: 'array', items: ltlTemplateResultSchema },
  },
  required: ['translations'],
  additionalProperties: false,
};

// --- Validation --------------------------------------------------------

// Validates a parsed `StructuredNLTranslations`-shaped object. Returns an error
// message string on failure, or null on success (mirroring
// `StructuredNLTranslations(**json_raw_output)` raising on validation failure).
export function validateStructuredNLTranslations(obj) {
  if (typeof obj !== 'object' || obj === null || !Array.isArray(obj.translations)) {
    return "invalid output format: 'translations' field (list) is required";
  }
  for (let i = 0; i < obj.translations.length; i++) {
    const entry = obj.translations[i];
    for (const field of Object.keys(structuredNLResultProperties)) {
      if (!(field in entry)) {
        return `invalid output format: translations[${i}] is missing field '${field}'`;
      }
    }
    if (!DECISION1_OPTIONS.includes(entry.decision1)) {
      return `invalid output format: translations[${i}].decision1 has an invalid value`;
    }
    if (!DECISION2_OPTIONS.includes(entry.decision2)) {
      return `invalid output format: translations[${i}].decision2 has an invalid value`;
    }
    if (!DECISION3_OPTIONS.includes(entry.decision3)) {
      return `invalid output format: translations[${i}].decision3 has an invalid value`;
    }
    if (entry.N_DURATION !== null && !Number.isInteger(entry.N_DURATION)) {
      return `invalid output format: translations[${i}].N_DURATION must be an integer or null`;
    }
  }
  return null;
}

// --- AP (atomic proposition) schema, used by data_loader.js ----------------

const apProperties = {
  variable_name: { title: 'Variable Name', type: 'string' },
  description: { title: 'Description', type: 'string' },
};

export const apSchema = {
  title: 'AP',
  type: 'object',
  properties: apProperties,
  required: Object.keys(apProperties),
  additionalProperties: false,
};

export const apListSchema = {
  title: 'APList',
  type: 'object',
  properties: {
    atomic_propositions: { title: 'Atomic Propositions', type: 'array', items: apSchema },
  },
  required: ['atomic_propositions'],
  additionalProperties: false,
};

// Validates a parsed `APList`-shaped object. Returns an error message string on
// failure, or null on success (mirroring `_APList(**json.loads(raw))`).
export function validateAPList(obj) {
  if (typeof obj !== 'object' || obj === null || !Array.isArray(obj.atomic_propositions)) {
    return "Invalid format: 'atomic_propositions' field (list) is required";
  }
  for (const ap of obj.atomic_propositions) {
    if (typeof ap !== 'object' || ap === null) {
      return 'Invalid format: each atomic proposition must be an object';
    }
    if (typeof ap.variable_name !== 'string' || typeof ap.description !== 'string') {
      return 'Invalid format: each atomic proposition needs variable_name and description strings';
    }
  }
  return null;
}

export { DECISION1_OPTIONS, DECISION2_OPTIONS, DECISION3_OPTIONS };
