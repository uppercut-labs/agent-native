import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  albumLookupV1,
  albumLookupV1ToV2,
  albumLookupV2,
  catalogLifecycle,
  catalogPack,
} from '@example/e08-album-contracts';
import {
  CapabilityMigrationError,
  assertCompatibleCapabilityReplacement,
  bindCapability,
  compareCapabilityDefinitions,
  composeCapabilityPacks,
  createCapabilityRegistry,
  defineCapability,
  defineCapabilityLifecyclePolicy,
  defineCapabilityMigration,
  defineCapabilityPack,
  executeCapability,
  validateCapabilityPackMigration,
} from '@uppercut-labs/agent-native';
import { legacyBinding } from '../src/consumer-a.mjs';
import { localizedBinding } from '../src/consumer-b.mjs';

const imported = {
  pack: catalogPack,
  source: 'test/e08.test.mjs:pack',
  aliasPolicy: {
    kind: 'explicit',
    aliases: [{ name: 'album-v1', capabilityId: 'example.org.catalog:album.lookup@1' }],
  },
};

const allow = { authorize: () => true };

test('v1 and v2 coexist with exact selection, a stable v1 alias, and distinct fixtures', async () => {
  const composition = composeCapabilityPacks([imported]);
  assert.equal(composition.resolve('album-v1'), albumLookupV1);
  assert.equal(
    composition.select({
      namespace: 'example.org.catalog',
      name: 'album.lookup',
      majorVersion: 2,
    }),
    albumLookupV2,
  );
  assert.equal(composition.resolve('album-v1'), albumLookupV1);

  const registry = createCapabilityRegistry(composition.definitions, [
    legacyBinding,
    localizedBinding,
  ]);
  const v1 = await executeCapability(registry, {
    identity: albumLookupV1.identity,
    runtime: 'local',
    input: { slug: 'kind-of-blue' },
    caller: { kind: 'anonymous' },
    authorization: allow,
  });
  const v2 = await executeCapability(registry, {
    identity: albumLookupV2.identity,
    runtime: 'local',
    input: { slug: 'kind-of-blue', locale: 'fr-FR' },
    caller: { kind: 'anonymous' },
    authorization: allow,
  });
  const fixtures = new URL('../fixtures/', import.meta.url);
  assert.deepEqual(v1.value, JSON.parse(await readFile(new URL('album-v1-output.json', fixtures))));
  assert.deepEqual(v2.value, JSON.parse(await readFile(new URL('album-v2-output.json', fixtures))));
  assert.equal('titles' in v1.value, false);
  assert.equal('title' in v2.value, false);
});

test('the declared migration reports required input and old output field removal', () => {
  assert.equal(albumLookupV1ToV2.contract.breaking, true);
  assert.ok(
    albumLookupV1ToV2.contract.changes.some(
      (change) =>
        change.area === 'input' && change.kind === 'required-added' && change.after === 'locale',
    ),
  );
  assert.ok(
    albumLookupV1ToV2.contract.changes.some(
      (change) =>
        change.area === 'output' &&
        change.kind === 'property-removed' &&
        /title$/.test(change.path),
    ),
  );
});

function schemaPort(jsonSchema) {
  return { parse: (value) => value, toJSONSchema: () => jsonSchema };
}

function definition(majorVersion, inputSchema, outputSchema = inputSchema) {
  return defineCapability({
    identity: { namespace: 'example.org.fixture', name: 'measure', majorVersion },
    description: 'Migration validation fixture.',
    input: schemaPort(inputSchema),
    output: schemaPort(outputSchema),
    risk: 'read',
    access: { kind: 'public' },
  });
}

test('reports changed defaults, units, field renames, and required inputs structurally', () => {
  const oldDefinition = definition(1, {
    type: 'object',
    properties: { distance: { type: 'number', default: 1, 'x-unit': 'cm' } },
    required: ['distance'],
  });
  const newDefinition = definition(2, {
    type: 'object',
    properties: {
      length: { type: 'number', default: 2, 'x-unit': 'in' },
      locale: { type: 'string' },
    },
    required: ['length', 'locale'],
  });
  const report = compareCapabilityDefinitions(oldDefinition, newDefinition);
  assert.ok(report.changes.some((change) => change.kind === 'property-removed'));
  assert.ok(report.changes.some((change) => change.kind === 'required-added'));

  const sameFieldReport = compareCapabilityDefinitions(
    oldDefinition,
    definition(2, {
      type: 'object',
      properties: { distance: { type: 'number', default: 2, 'x-unit': 'in' } },
      required: ['distance'],
    }),
  );
  assert.ok(sameFieldReport.changes.some((change) => change.path.endsWith('.default')));
  assert.ok(sameFieldReport.changes.some((change) => change.path.endsWith('.x-unit')));

  const renameReport = compareCapabilityDefinitions(
    definition(1, { type: 'object', properties: { oldName: { type: 'string' } } }),
    definition(2, { type: 'object', properties: { newName: { type: 'string' } } }),
  );
  assert.ok(renameReport.changes.some((change) => change.kind === 'property-renamed'));
});

test('same-schema major changes still require substantive semantic review', () => {
  const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] };
  assert.throws(
    () =>
      defineCapabilityMigration({
        previous: definition(1, schema),
        next: definition(2, schema),
      }),
    (error) =>
      error instanceof CapabilityMigrationError && error.kind === 'missing-semantic-review',
  );
});

test('a v1 identity cannot silently accept a breaking replacement', () => {
  const stableSchema = {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
  };
  const oldDefinition = definition(1, stableSchema);
  const replacement = definition(1, {
    type: 'object',
    properties: { value: { type: 'number' }, locale: { type: 'string' } },
    required: ['value', 'locale'],
  });
  assert.throws(
    () => assertCompatibleCapabilityReplacement(oldDefinition, replacement),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'breaking-replacement',
  );
  const implementationOnlyReplacement = defineCapability({
    identity: oldDefinition.identity,
    description: 'A new implementation release with the same definition contract.',
    input: schemaPort(stableSchema),
    output: schemaPort(stableSchema),
    risk: 'read',
    access: { kind: 'public' },
  });
  assert.doesNotThrow(() =>
    assertCompatibleCapabilityReplacement(oldDefinition, implementationOnlyReplacement),
  );
});

test('a supported major cannot disappear through implicit retirement', () => {
  const previous = defineCapabilityPack({
    identity: { authority: 'example.org', namespace: 'catalog' },
    source: 'previous',
    definitions: [albumLookupV1],
  });
  const next = defineCapabilityPack({
    identity: { authority: 'example.org', namespace: 'catalog' },
    source: 'next',
    definitions: [albumLookupV2],
  });
  assert.throws(
    () =>
      validateCapabilityPackMigration({
        previous,
        next,
        migrations: [albumLookupV1ToV2],
        previousLifecycle: defineCapabilityLifecyclePolicy([
          { capabilityId: 'example.org.catalog:album.lookup@1', state: 'supported' },
        ]),
        nextLifecycle: defineCapabilityLifecyclePolicy([
          { capabilityId: 'example.org.catalog:album.lookup@2', state: 'supported' },
        ]),
      }),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'implicit-removal',
  );
});

test('a previously deprecated major can be removed only with reviewed lifecycle state', () => {
  const next = defineCapabilityPack({
    identity: { authority: 'example.org', namespace: 'catalog' },
    source: 'post-retirement',
    definitions: [albumLookupV2],
  });
  const report = validateCapabilityPackMigration({
    previous: catalogPack,
    next,
    migrations: [],
    previousLifecycle: catalogLifecycle,
    nextLifecycle: defineCapabilityLifecyclePolicy([
      {
        capabilityId: 'example.org.catalog:album.lookup@1',
        state: 'removed',
        note: 'Legacy consumers completed their explicit migration and retention window.',
        reviewedBy: 'catalog-contract-owner',
      },
      { capabilityId: 'example.org.catalog:album.lookup@2', state: 'supported' },
    ]),
  });
  assert.deepEqual(report.removed, ['example.org.catalog:album.lookup@1']);
});

test('each consumer app selects its major in an independent process', () => {
  for (const [entrypoint, bindingId] of [
    ['demo.mjs', 'legacy-consumer'],
    ['demo-b.mjs', 'localized-consumer'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [new URL(`../src/${entrypoint}`, import.meta.url).pathname],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.kind, 'success');
    assert.equal(output.bindingId, bindingId);
  }
});

test('contract-only import does not load executor, registry, or provider modules', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'e08-import-'));
  const trace = path.join(temporary, 'trace.txt');
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-loader',
        new URL('./trace-loader.mjs', import.meta.url).pathname,
        new URL('./import-contract.mjs', import.meta.url).pathname,
      ],
      { encoding: 'utf8', env: { ...process.env, E08_IMPORT_TRACE: trace } },
    );
    assert.equal(result.status, 0, result.stderr);
    const loaded = await readFile(trace, 'utf8');
    assert.match(loaded, /core\/contracts\.js/);
    assert.match(loaded, /core\/composition\.js/);
    assert.doesNotMatch(loaded, /core\/(executor|registry)\.js|\/mcp\.js|\/http\.js|adapters\/zod/);
    assert.doesNotMatch(loaded, /catalog-data|consumer-[ab]/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
