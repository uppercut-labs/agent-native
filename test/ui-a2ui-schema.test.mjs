// Checks the UI catalog and the messages the built-in patterns emit against the official A2UI
// v1.0 JSON schemas, vendored with hashes in test/fixtures/a2ui-v1_0. Run after `npm run build`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { CatalogRegistry, defaultCatalog, UI_CATALOG_ID, UiStore } from '../dist/ui.js';
import { mediaAnnotation, parameterExplorer, reviewQueue } from '../dist/ui-patterns.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'test', 'fixtures', 'a2ui-v1_0');
const UPSTREAM = 'https://a2ui.org/specification/v1_0/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function loadSchemas() {
  const names = ['agent_to_renderer', 'common_types', 'catalog_definition', 'renderer_to_agent'];
  const schemas = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readJson(path.join(fixtures, `${name}.json`))]),
    ),
  );
  const catalog = await readJson(path.join(root, 'docs', 'ui', 'a2ui-catalog.json'));
  // The envelope schema resolves components and functions through a sibling `catalog.json`.
  // Serve this package's catalog definition at that address for message validation.
  const asCatalogJson = { ...catalog, $id: `${UPSTREAM}catalog.json` };
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    discriminator: true,
    validateFormats: false,
  });
  for (const name of names) ajv.addSchema(schemas[name]);
  ajv.addSchema(asCatalogJson);
  return {
    catalog,
    message: ajv.getSchema(`${UPSTREAM}agent_to_renderer.json`),
    catalogDefinition: ajv.getSchema(`${UPSTREAM}catalog_definition.json`),
  };
}

const schemas = await loadSchemas();
const valid = (validate, value) => {
  const ok = validate(value);
  return { ok, errors: ok ? [] : validate.errors };
};

const patternMessages = () => [
  reviewQueue([
    { id: 'r1', title: 'Intro', category: 'copy', before: 'Hi', draft: 'Hello' },
    { id: 'r2', title: 'Outro', category: 'copy', before: 'Bye', draft: 'Goodbye' },
  ]),
  reviewQueue([], 'saveReview', 'empty_review'),
  parameterExplorer(),
  mediaAnnotation({
    kind: 'audio',
    source: 'fixture-audio',
    duration: 12,
    lines: [{ id: 'l1', start: 0, text: 'First line' }],
  }),
  mediaAnnotation(
    { kind: 'video', source: 'fixture-video', duration: 1, lines: [] },
    'saveAnnotations',
    'video',
  ),
];

test('vendored A2UI schemas match their recorded SHA-256 hashes', async () => {
  const table = await readFile(path.join(fixtures, 'SOURCE.md'), 'utf8');
  const rows = [...table.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
  assert.equal(rows.length, 5);
  for (const [, file, expected] of rows) {
    const actual = createHash('sha256')
      .update(await readFile(path.join(fixtures, file)))
      .digest('hex');
    assert.equal(actual, expected, file);
  }
});

test('the generated catalog file is current', () => {
  const out = execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'generate-ui-catalog.mjs'), '--check'],
    { encoding: 'utf8' },
  );
  assert.match(out, /matches the registered catalog/);
});

test('the catalog is a valid A2UI v1.0 catalog definition', () => {
  const result = valid(schemas.catalogDefinition, schemas.catalog);
  assert.ok(result.ok, JSON.stringify(result.errors, null, 2));
  assert.equal(schemas.catalog.catalogId, UI_CATALOG_ID);
  assert.equal(schemas.catalog.protocolVersion, '1.0');
});

test('the catalog file lists exactly the registered components, properties and functions', () => {
  const described = new CatalogRegistry([defaultCatalog()]).describe().catalogs[0];
  const components = schemas.catalog.components;
  assert.deepEqual(
    Object.keys(components).sort(),
    described.components.map((c) => c.component).sort(),
  );
  for (const { component, properties, required } of described.components) {
    const schema = components[component];
    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      ['component', ...properties].sort(),
      component,
    );
    assert.deepEqual(schema.required.sort(), ['component', ...required].sort(), component);
  }
  assert.deepEqual(
    Object.keys(schemas.catalog.functions).sort(),
    described.functions.map((fn) => fn.name).sort(),
  );
});

test('every built-in pattern message is valid A2UI v1.0 and is accepted by the store', () => {
  const store = new UiStore();
  for (const message of patternMessages()) {
    const result = valid(schemas.message, message);
    assert.ok(result.ok, JSON.stringify(result.errors, null, 2));
    assert.equal(store.apply(message).kind, 'applied', JSON.stringify(message).slice(0, 200));
  }
});

test('incremental update and delete messages are valid A2UI v1.0', () => {
  const store = new UiStore();
  const messages = [
    parameterExplorer('steps'),
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'steps',
        components: [{ id: 'heading', component: 'Text', text: 'Updated', variant: 'heading' }],
      },
    },
    { version: '1.0', updateDataModel: { surfaceId: 'steps', path: '/attempts', value: 5 } },
    { version: '1.0', deleteSurface: { surfaceId: 'steps' } },
  ];
  for (const message of messages) {
    const result = valid(schemas.message, message);
    assert.ok(result.ok, JSON.stringify(result.errors, null, 2));
    assert.equal(store.apply(message).kind, 'applied', JSON.stringify(message));
  }
});

test('messages outside the catalog are rejected by both the official schema and the store', () => {
  const surface = (components) => ({
    version: '1.0',
    createSurface: { surfaceId: 'bad', catalogId: UI_CATALOG_ID, components, dataModel: {} },
  });
  const cases = {
    'unknown component': surface([{ id: 'root', component: 'Script', src: 'x.js' }]),
    'unknown property': surface([{ id: 'root', component: 'Text', text: 'Hi', html: '<b>Hi</b>' }]),
    'missing required property': surface([{ id: 'root', component: 'Slider', label: 'Rate' }]),
    'enum outside the catalog': surface([
      { id: 'root', component: 'Text', text: 'Hi', variant: 'blink' },
    ]),
    'reserved Surface component': surface([{ id: 'root', component: 'Surface', child: 'x' }]),
    'unregistered function': surface([
      { id: 'root', component: 'Output', label: 'X', value: { '@call': 'fetchUrl', args: {} } },
    ]),
    'unsupported version': { version: '0.9', deleteSurface: { surfaceId: 'bad' } },
    'two operations in one message': {
      version: '1.0',
      deleteSurface: { surfaceId: 'a' },
      updateDataModel: { surfaceId: 'a', value: {} },
    },
  };
  for (const [name, message] of Object.entries(cases)) {
    assert.equal(valid(schemas.message, message).ok, false, `schema accepted ${name}`);
    assert.equal(new UiStore().apply(message).kind, 'rejected', `store accepted ${name}`);
  }
});
