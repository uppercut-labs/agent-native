import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { fromZod } from '../dist/adapters/zod.js';
import {
  bindCapability,
  CapabilityCompositionError,
  capabilitySurfaceNames,
  composeCapabilityPacks,
  createCapabilityRegistry,
  defineCapability,
  defineCapabilityPack,
  executeCapability,
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
