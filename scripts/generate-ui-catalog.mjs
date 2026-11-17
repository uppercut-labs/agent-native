// Writes docs/ui/a2ui-catalog.json: the default Agent Native UI catalog as an A2UI v1.0
// catalog definition (specification/v1_0/json/catalog_definition.json). Run after `npm run build`.
//   node scripts/generate-ui-catalog.mjs          rewrites the file
//   node scripts/generate-ui-catalog.mjs --check  fails if the file is out of date
// Component names, properties and required fields come from the registered catalog; this file
// only supplies each property's JSON Schema. test/ui-a2ui-schema.test.mjs checks both agree.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs', 'ui', 'a2ui-catalog.json');
const { CatalogRegistry, defaultCatalog, UI_CATALOG_ID } = await import(
  path.join(root, 'dist', 'ui.js')
);

const common = (name) => ({ $ref: `common_types.json#/$defs/${name}` });
const DynamicString = common('DynamicString');
const DynamicNumber = common('DynamicNumber');
const DynamicBoolean = common('DynamicBoolean');
const DynamicValue = common('DynamicValue');
const DataBinding = common('DataBinding');
const ComponentId = common('ComponentId');
const listOrBinding = { oneOf: [{ type: 'array' }, DataBinding] };
const childIds = { type: 'array', items: ComponentId, maxItems: 256 };
const literal = (type) => ({ type });
const oneOfStrings = (...values) => ({ type: 'string', enum: values });
const eventAction = {
  type: 'object',
  description: 'Dispatches a named event; the application maps it to a fixed capability.',
  properties: {
    event: {
      type: 'object',
      properties: {
        name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,127}$' },
        context: { type: 'object', additionalProperties: DynamicValue },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  required: ['event'],
  additionalProperties: false,
};

// Property schemas shared by name. A component-specific entry below overrides these.
const shared = {
  children: childIds,
  label: DynamicString,
  title: DynamicString,
  text: DynamicString,
  description: DynamicString,
  placeholder: literal('string'),
  suffix: DynamicString,
  emptyText: literal('string'),
  disabled: DynamicBoolean,
  multiline: literal('boolean'),
  min: literal('number'),
  max: literal('number'),
  step: { type: 'number', exclusiveMinimum: 0 },
  action: eventAction,
  before: DynamicValue,
  after: DynamicValue,
  rows: listOrBinding,
  items: listOrBinding,
  points: listOrBinding,
  lines: listOrBinding,
  selection: DynamicValue,
  sort: DynamicValue,
  source: DynamicString,
  position: DynamicNumber,
  duration: DynamicNumber,
  end: DynamicNumber,
  mediaId: ComponentId,
  actionName: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,127}$' },
  value: DataBinding,
};
const specific = {
  Tabs: {
    labels: { type: 'array', items: { type: 'string' }, maxItems: 256 },
    value: DynamicValue,
    label: literal('string'),
  },
  Text: { variant: oneOfStrings('body', 'heading', 'caption', 'code') },
  Status: { kind: oneOfStrings('loading', 'empty', 'error', 'denied', 'success', 'info') },
  TextField: { label: literal('string') },
  NumberField: { label: literal('string') },
  CheckBox: { label: literal('string') },
  ChoicePicker: {
    label: literal('string'),
    options: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: { label: literal('string'), value: literal('string') },
        required: ['label', 'value'],
        additionalProperties: false,
      },
    },
    variant: oneOfStrings('select', 'radio'),
  },
  Slider: { label: literal('string') },
  Button: { variant: oneOfStrings('primary', 'secondary') },
  DecisionCard: { label: DynamicString },
  Table: {
    columns: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        properties: { key: ComponentId, label: literal('string') },
        required: ['key', 'label'],
        additionalProperties: false,
      },
    },
  },
  Chart: { max: DynamicNumber },
  Output: { value: DynamicValue },
  Timeline: { value: DynamicNumber },
};

export function buildCatalog() {
  const described = new CatalogRegistry([defaultCatalog()]).describe().catalogs[0];
  const components = {};
  for (const { component, properties, required } of described.components) {
    const props = { component: { const: component } };
    for (const name of properties) {
      const schema = specific[component]?.[name] ?? shared[name];
      if (schema === undefined) throw new Error(`No schema for ${component}.${name}`);
      props[name] = schema;
    }
    components[component] = {
      type: 'object',
      properties: props,
      required: ['component', ...required],
    };
  }
  // Arguments may be literals or data bindings; the renderer resolves bindings before the
  // registered function validates the resolved values.
  const boundOr = (schema) => ({ oneOf: [schema, DataBinding] });
  const functionArgs = {
    probability: {
      attempts: boundOr({ type: 'integer', minimum: 0, maximum: 10000 }),
      rate: boundOr({ type: 'number', minimum: 0, maximum: 1 }),
    },
    percent: { value: boundOr(literal('number')) },
  };
  const functionReturns = { probability: 'number', percent: 'string' };
  const functions = {};
  for (const fn of described.functions) {
    const args = functionArgs[fn.name];
    if (args === undefined) throw new Error(`No argument schema for function ${fn.name}`);
    functions[fn.name] = {
      type: 'object',
      returnType: functionReturns[fn.name],
      allowedCallers: fn.allowedCallers,
      properties: {
        '@call': { const: fn.name },
        args: {
          type: 'object',
          properties: args,
          required: Object.keys(args),
          unevaluatedProperties: false,
        },
      },
      required: ['@call', 'args'],
    };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/uppercut-labs/agent-native/docs/ui/a2ui-catalog.json',
    catalogId: UI_CATALOG_ID,
    protocolVersion: '1.0',
    title: 'Agent Native UI catalog',
    description:
      'Components and renderer functions accepted by @uppercut-labs/agent-native/ui. A custom catalog: names that match the A2UI Basic Catalog do not share its properties.',
    $defs: {
      anyComponent: {
        oneOf: Object.keys(components).map((name) => ({ $ref: `#/components/${name}` })),
        discriminator: { propertyName: 'component' },
      },
      anyFunction: {
        oneOf: Object.keys(functions).map((name) => ({ $ref: `#/functions/${name}` })),
      },
    },
    components,
    functions,
  };
}

const text = `${JSON.stringify(buildCatalog(), null, 2)}\n`;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== text) {
      console.error(
        'docs/ui/a2ui-catalog.json is out of date. Run node scripts/generate-ui-catalog.mjs.',
      );
      process.exit(1);
    }
    console.log('docs/ui/a2ui-catalog.json matches the registered catalog.');
  } else {
    await writeFile(target, text);
    console.log('Wrote docs/ui/a2ui-catalog.json');
  }
}
