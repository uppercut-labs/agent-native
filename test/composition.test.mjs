import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { fromZod } from '../dist/adapters/zod.js';
import {
  bindCapability,
  CapabilityMigrationError,
  assertCompatibleCapabilityReplacement,
  CapabilityCompositionError,
  capabilitySurfaceNames,
  composeCapabilityPacks,
  createCapabilityRegistry,
  compareCapabilityDefinitions,
  defineCapability,
  defineCapabilityLifecyclePolicy,
  defineCapabilityMigration,
  defineCapabilityPack,
  executeCapability,
  validateCapabilityPackMigration,
} from '../dist/index.js';

const input = fromZod(z.object({ value: z.number() }));
const output = fromZod(z.object({ value: z.number(), provider: z.string() }));

function pack(authority, source, name = 'value.convert') {
  const definition = defineCapability({
    identity: { namespace: `${authority}.units`, name, majorVersion: 1 },
    description: 'Convert a value.',
    input,
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['units:convert'] },
  });
  return {
    definition,
    pack: defineCapabilityPack({
      identity: { authority, namespace: 'units' },
      source,
      definitions: [definition],
    }),
  };
}

test('packs retain authority identity and require explicit, unambiguous aliases', () => {
  const north = pack('north.example', '@north/contracts');
  const south = pack('south.example', '@south/contracts');
  const composition = composeCapabilityPacks([
    {
      pack: north.pack,
      source: 'app.ts:10',
      aliasPolicy: {
        kind: 'explicit',
        aliases: [
          {
            name: 'north-convert',
            capabilityId: 'north.example.units:value.convert@1',
            source: 'app.ts:14',
          },
        ],
      },
    },
    { pack: south.pack, source: 'app.ts:20', aliasPolicy: { kind: 'none' } },
  ]);

  assert.equal(composition.definitions.length, 2);
  assert.equal(composition.resolve('north-convert'), north.definition);
  assert.equal(composition.resolve('south.example.units:value.convert@1'), south.definition);
  assert.equal(composition.aliases.set, undefined);
});

test('coexisting majors use exact selection and same-ID replacements are checked', () => {
  const first = pack('versions.example', '@versions/contracts');
  const secondDefinition = defineCapability({
    identity: { ...first.definition.identity, majorVersion: 2 },
    description: 'Convert a value with the v2 contract.',
    input: fromZod(z.object({ value: z.number(), locale: z.string() })),
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['units:convert'] },
  });
  const migration = defineCapabilityMigration({
    previous: first.definition,
    next: secondDefinition,
    semanticReview: {
      note: 'V2 requires an explicit locale before the conversion implementation runs.',
      reviewedBy: 'units-contract-owner',
    },
  });
  assert.throws(
    () =>
      defineCapabilityPack({
        identity: { authority: 'versions.example', namespace: 'units' },
        source: '@versions/unreviewed-contracts',
        definitions: [first.definition, secondDefinition],
      }),
    (error) =>
      error instanceof CapabilityMigrationError && error.kind === 'missing-semantic-review',
  );
  const versionedPack = defineCapabilityPack({
    identity: { authority: 'versions.example', namespace: 'units' },
    source: '@versions/contracts',
    definitions: [first.definition, secondDefinition],
    migrations: [migration],
    lifecycle: defineCapabilityLifecyclePolicy([
      { capabilityId: 'versions.example.units:value.convert@1', state: 'supported' },
      { capabilityId: 'versions.example.units:value.convert@2', state: 'supported' },
    ]),
  });
  const forgedLifecycle = {
    entries: [],
    get: (capabilityId) => ({ capabilityId, state: 'supported' }),
  };
  assert.throws(
    () =>
      defineCapabilityPack({
        identity: versionedPack.identity,
        source: '@versions/forged-lifecycle',
        definitions: versionedPack.definitions,
        migrations: [migration],
        lifecycle: forgedLifecycle,
      }),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'invalid-lifecycle',
  );
  const composition = composeCapabilityPacks([
    {
      pack: versionedPack,
      source: 'versions.ts:1',
      aliasPolicy: {
        kind: 'explicit',
        aliases: [{ name: 'convert-v1', capabilityId: 'versions.example.units:value.convert@1' }],
      },
    },
  ]);

  assert.equal(composition.resolve('convert-v1'), first.definition);
  assert.equal(composition.select(secondDefinition.identity), secondDefinition);
  const report = compareCapabilityDefinitions(first.definition, secondDefinition);
  assert.ok(report.changes.some((change) => change.kind === 'required-added'));
  assert.throws(
    () => assertCompatibleCapabilityReplacement(first.definition, secondDefinition),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'invalid-migration',
  );
});

test('migration reports include risk and access metadata changes', () => {
  const previous = pack('metadata.example', '@metadata/contracts').definition;
  const next = defineCapability({
    identity: { ...previous.identity, majorVersion: 2 },
    description: 'Convert a value with protected write semantics.',
    input,
    output,
    risk: 'write',
    access: { kind: 'protected', scopes: ['units:write'] },
  });
  const report = compareCapabilityDefinitions(previous, next);

  assert.equal(report.schemaEquivalent, true);
  assert.ok(report.changes.some((change) => change.area === 'risk'));
  assert.ok(report.changes.some((change) => change.area === 'access'));
});

test('surface overrides require a new major while description-only changes do not', () => {
  const previous = pack('surface.example', '@surface/contracts').definition;
  const sameIdWithRoute = defineCapability({
    identity: previous.identity,
    description: previous.description,
    input,
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['units:convert'] },
    surfaces: {
      http: { path: '/api/convert', method: 'GET' },
      cli: { command: 'convert' },
    },
  });
  const report = compareCapabilityDefinitions(previous, sameIdWithRoute);
  assert.equal(report.schemaEquivalent, true);
  assert.ok(report.changes.some((change) => change.area === 'surface' && change.breaking));
  assert.throws(
    () => assertCompatibleCapabilityReplacement(previous, sameIdWithRoute),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'breaking-replacement',
  );
  const descriptionOnly = defineCapability({
    identity: previous.identity,
    description: 'Same conversion with clearer operator wording.',
    input,
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['units:convert'] },
  });
  assert.equal(assertCompatibleCapabilityReplacement(previous, descriptionOnly).breaking, false);
});

test('migration records are revalidated instead of trusting structural lookalikes', () => {
  const previous = pack('review.example', '@review/contracts');
  const nextDefinition = defineCapability({
    identity: { ...previous.definition.identity, majorVersion: 2 },
    description: 'Convert with a required locale.',
    input: fromZod(z.object({ value: z.number(), locale: z.string() })),
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['units:convert'] },
  });
  const migration = defineCapabilityMigration({
    previous: previous.definition,
    next: nextDefinition,
    semanticReview: {
      note: 'V2 requires locale and preserves the unit conversion meaning.',
      reviewedBy: 'contract-owner',
    },
  });
  const lifecycle = defineCapabilityLifecyclePolicy([
    { capabilityId: 'review.example.units:value.convert@1', state: 'supported' },
    { capabilityId: 'review.example.units:value.convert@2', state: 'supported' },
  ]);
  assert.throws(
    () =>
      defineCapabilityPack({
        identity: previous.pack.identity,
        source: '@review/forged',
        definitions: [previous.definition, nextDefinition],
        migrations: [{ ...migration, semanticReview: { note: 'same', reviewedBy: 'qa' } }],
        lifecycle,
      }),
    (error) =>
      error instanceof CapabilityMigrationError && error.kind === 'missing-semantic-review',
  );
  assert.throws(
    () =>
      defineCapabilityPack({
        identity: previous.pack.identity,
        source: '@review/forged-report',
        definitions: [previous.definition, nextDefinition],
        migrations: [
          { ...migration, contract: { ...migration.contract, changes: [], breaking: false } },
        ],
        lifecycle,
      }),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'invalid-migration',
  );
  const next = defineCapabilityPack({
    identity: previous.pack.identity,
    source: '@review/contracts-v2',
    definitions: [previous.definition, nextDefinition],
    migrations: [migration],
    lifecycle,
  });
  assert.notEqual(next.migrations[0], migration);
  assert.equal(next.migrations[0].contract.breaking, true);
  const report = validateCapabilityPackMigration({
    previous: previous.pack,
    next,
    migrations: [
      { ...migration, contract: { ...migration.contract, changes: [], breaking: false } },
    ],
    previousLifecycle: defineCapabilityLifecyclePolicy([
      { capabilityId: 'review.example.units:value.convert@1', state: 'supported' },
    ]),
    nextLifecycle: lifecycle,
  });
  assert.equal(report.contractChanges.at(-1).breaking, true);
});

test('adding an output property breaks a closed same-major response schema', () => {
  const schemaPort = (schema) => ({ parse: (value) => value, toJSONSchema: () => schema });
  const identity = { namespace: 'schema.example.units', name: 'value.convert', majorVersion: 1 };
  const priorOutput = {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  };
  const nextOutput = {
    ...priorOutput,
    properties: { ...priorOutput.properties, provider: { type: 'string' } },
  };
  const definition = (outputSchema) =>
    defineCapability({
      identity,
      description: 'Convert a value.',
      input,
      output: schemaPort(outputSchema),
      risk: 'read',
      access: { kind: 'protected', scopes: ['units:convert'] },
    });
  const before = definition(priorOutput);
  const after = definition(nextOutput);
  const report = compareCapabilityDefinitions(before, after);
  assert.ok(
    report.changes.some(
      (change) => change.area === 'output' && change.kind === 'property-added' && change.breaking,
    ),
  );
  assert.throws(
    () => assertCompatibleCapabilityReplacement(before, after),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'breaking-replacement',
  );
  assert.doesNotThrow(() =>
    assertCompatibleCapabilityReplacement(
      definition({ ...priorOutput, additionalProperties: true }),
      definition({ ...nextOutput, additionalProperties: true }),
    ),
  );
});

test('a forged lifecycle getter cannot claim reviewed removal without an entry', () => {
  const previous = pack('retirement.example', '@retirement/contracts');
  const next = defineCapabilityPack({
    identity: previous.pack.identity,
    source: '@retirement/empty',
    definitions: [],
  });
  const priorPolicy = defineCapabilityLifecyclePolicy([
    {
      capabilityId: 'retirement.example.units:value.convert@1',
      state: 'deprecated',
      note: 'Consumers have been notified and are migrating to the new contract.',
    },
  ]);
  const forgedNextPolicy = {
    entries: [],
    get: (capabilityId) => ({
      capabilityId,
      state: 'removed',
      note: 'Pretend this retirement was reviewed and approved.',
      reviewedBy: 'contract-owner',
    }),
  };
  assert.throws(
    () =>
      validateCapabilityPackMigration({
        previous: previous.pack,
        next,
        migrations: [],
        previousLifecycle: priorPolicy,
        nextLifecycle: forgedNextPolicy,
      }),
    (error) => error instanceof CapabilityMigrationError && error.kind === 'implicit-removal',
  );
});

test('full identity and alias conflicts report both source locations', () => {
  const first = pack('conflict.example', '@first/contracts');
  const second = pack('conflict.example', '@second/contracts');
  assert.throws(
    () => composeCapabilityPacks([{ pack: first.pack, source: 'missing-policy.ts:1' }]),
    /must declare aliasPolicy/,
  );
  assert.throws(
    () =>
      composeCapabilityPacks([
        { pack: first.pack, source: 'first.ts:3', aliasPolicy: { kind: 'none' } },
        { pack: second.pack, source: 'second.ts:8', aliasPolicy: { kind: 'none' } },
      ]),
    (error) =>
      error instanceof CapabilityCompositionError &&
      error.kind === 'duplicate-identity' &&
      /first\.ts:3/.test(error.message) &&
      /second\.ts:8/.test(error.message),
  );

  const north = pack('north.example', '@north/contracts');
  const south = pack('south.example', '@south/contracts');
  assert.throws(
    () =>
      composeCapabilityPacks([
        {
          pack: north.pack,
          source: 'one.ts:1',
          aliasPolicy: {
            kind: 'explicit',
            aliases: [{ name: 'convert', capabilityId: 'north.example.units:value.convert@1' }],
          },
        },
        {
          pack: south.pack,
          source: 'two.ts:2',
          aliasPolicy: {
            kind: 'explicit',
            aliases: [{ name: 'convert', capabilityId: 'south.example.units:value.convert@1' }],
          },
        },
      ]),
    (error) =>
      error instanceof CapabilityCompositionError &&
      error.kind === 'alias-collision' &&
      /one\.ts:1/.test(error.message) &&
      /two\.ts:2/.test(error.message),
  );
});

test('composition rechecks ownership of structural pack imports', () => {
  const original = pack('example.org', '@example/contracts');
  const spoofed = {
    ...original.pack,
    identity: { authority: 'attacker.example', namespace: 'units' },
  };
  assert.throws(
    () =>
      composeCapabilityPacks([
        { pack: spoofed, source: 'app.mjs:7', aliasPolicy: { kind: 'none' } },
      ]),
    (error) =>
      error instanceof CapabilityCompositionError &&
      error.kind === 'invalid-pack' &&
      /app\.mjs:7/.test(error.message) &&
      /attacker\.example\.units/.test(error.message),
  );
});

test('composition rejects structural multi-major packs without reviewed migration policy', () => {
  const original = pack('versioned.example', '@versioned/contracts');
  const secondDefinition = defineCapability({
    identity: { ...original.definition.identity, majorVersion: 2 },
    description: 'Second version of conversion.',
    input,
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['units:convert'] },
  });
  const unreviewed = { ...original.pack, definitions: [original.definition, secondDefinition] };
  assert.throws(
    () =>
      composeCapabilityPacks([
        { pack: unreviewed, source: 'app.mjs:8', aliasPolicy: { kind: 'none' } },
      ]),
    (error) =>
      error instanceof CapabilityMigrationError && error.kind === 'missing-semantic-review',
  );
});

test('surface names are deterministic and long MCP names are visibly digest-qualified', () => {
  const identity = {
    namespace: 'a'.repeat(64),
    name: 'conversion'.padEnd(64, 'x'),
    majorVersion: 1,
  };
  const first = capabilitySurfaceNames(identity);
  const second = capabilitySurfaceNames(identity);

  assert.deepEqual(first, second);
  assert.equal(first.cli, `${identity.namespace}:${identity.name}@1`);
  assert.match(first.mcp, /_fnv1a64_[0-9a-f]{16}$/);
  assert.ok(first.mcp.length <= 128);
  assert.match(first.http, /\/capabilities\//);

  const samePrefix = capabilitySurfaceNames({
    ...identity,
    name: `${identity.name.slice(0, -1)}y`,
  });
  assert.notEqual(first.mcp, samePrefix.mcp);
  assert.equal(first.mcp.slice(0, 101), samePrefix.mcp.slice(0, 101));
});

test('composed definitions execute with consumer bindings and preserve scoped request context', async () => {
  const contract = pack('shared.example', '@shared/contracts');
  const composition = composeCapabilityPacks([
    { pack: contract.pack, source: 'consumer.ts:5', aliasPolicy: { kind: 'none' } },
  ]);
  const seen = [];
  const signal = { aborted: false };
  const first = bindCapability(contract.definition, {
    id: 'first-provider',
    targets: ['local'],
    execute(value, context) {
      seen.push(context);
      return { value: value.value + 1, provider: 'first' };
    },
  });
  const second = bindCapability(contract.definition, {
    id: 'second-provider',
    targets: ['local'],
    execute(value) {
      return { value: value.value + 2, provider: 'second' };
    },
  });
  const registry = createCapabilityRegistry(composition.definitions, [first, second]);
  const caller = { kind: 'authenticated', subject: 'user-7', scopes: ['units:convert'] };
  let authorizationRequest;
  const request = {
    identity: contract.definition.identity,
    runtime: 'local',
    input: { value: 2 },
    caller,
    signal,
    bindingId: 'first-provider',
    authorization: {
      authorize(value) {
        authorizationRequest = value;
        return value.caller === caller && value.access.scopes.includes('units:convert');
      },
    },
  };
  const allowed = await executeCapability(registry, request);

  assert.equal(allowed.kind, 'success');
  assert.equal(authorizationRequest.caller, caller);
  assert.deepEqual(seen, [
    { capabilityId: 'shared.example.units:value.convert@1', runtime: 'local', signal },
  ]);

  const denied = await executeCapability(registry, {
    ...request,
    authorization: { authorize: () => false },
  });
  assert.deepEqual(denied.kind, 'failure');
  if (denied.kind === 'failure') assert.equal(denied.reason, 'unauthorized');
  assert.equal(seen.length, 1);
});
