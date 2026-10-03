import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import { runCapabilityCli, CLI_RESULT_JSON_SCHEMA } from '../dist/cli.js';
import Ajv2020 from 'ajv/dist/2020.js';

function fixture(execute) {
  const input = fromZod(z.object({ text: z.string() }));
  const output = fromZod(z.any());
  const definition = defineCapability({
    identity: { namespace: 'cli.test', name: 'run', majorVersion: 1 },
    description: 'CLI test capability.',
    input,
    output,
    risk: 'read',
    access: { kind: 'public' },
  });
  const binding = bindCapability(definition, {
    id: 'local-cli-test',
    targets: ['local'],
    execute,
  });
  return createCapabilityRegistry([definition], [binding]);
}

async function invoke(registry, argv, authorization = { authorize: () => true }, readStdin) {
  let stdout = '';
  let stderr = '';
  const code = await runCapabilityCli(
    argv,
    {
      registry,
      authorization,
      caller: { kind: 'anonymous' },
    },
    {
      writeStdout(value) {
        stdout += value;
      },
      writeStderr(value) {
        stderr += value;
      },
      ...(readStdin === undefined ? {} : { readStdin }),
    },
  );
  return { code, stdout, stderr };
}

test('invalid flags and structured input fail before the local handler', async () => {
  let calls = 0;
  const registry = fixture(async (input) => {
    calls += 1;
    return input;
  });
  const invalidFlag = await invoke(registry, [
    '--mode',
    'local',
    'cli.test:run@1',
    '--unknown',
    'value',
  ]);
  assert.equal(invalidFlag.code, 1);
  assert.equal(JSON.parse(invalidFlag.stdout).result.kind, 'failure');
  assert.equal(calls, 0);

  const invalidInput = await invoke(registry, [
    '--mode',
    'local',
    'cli.test:run@1',
    '--input-json',
    '{"text":2}',
  ]);
  assert.equal(invalidInput.code, 2);
  assert.equal(JSON.parse(invalidInput.stdout).result.reason, 'invalid-input');
  assert.equal(calls, 0);
});

test('authorization denial keeps a machine result and never calls a handler', async () => {
  let calls = 0;
  const registry = fixture(async () => {
    calls += 1;
    return {};
  });
  const result = await invoke(registry, ['--mode', 'local', 'cli.test:run@1', '--text', 'hello'], {
    authorize: () => false,
  });
  assert.equal(result.code, 3);
  assert.equal(JSON.parse(result.stdout).result.reason, 'unauthorized');
  assert.match(result.stderr, /execution=unauthorized/);
  assert.equal(calls, 0);
});

test('non-JSON-serializable handler output is replaced by a valid failure envelope', async () => {
  const registry = fixture(async () => 1n);
  const result = await invoke(registry, ['--mode', 'local', 'cli.test:run@1', '--text', 'hello']);
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout).result, {
    kind: 'failure',
    reason: 'result-serialization-failed',
  });
});

test('versioned CLI result schema validates success and failure envelopes', async () => {
  const registry = fixture(async (input) => input);
  const success = await invoke(registry, ['--mode', 'local', 'cli.test:run@1', '--text', 'hello']);
  const invalid = await invoke(registry, ['--mode', 'local', 'cli.test:run@1', '--text', '']);
  const validate = new Ajv2020().compile(CLI_RESULT_JSON_SCHEMA);
  assert.equal(validate(JSON.parse(success.stdout)), true);
  assert.equal(validate(JSON.parse(invalid.stdout)), true);
  assert.equal(
    validate({ schemaVersion: 'wrong', target: {}, result: { kind: 'success' } }),
    false,
  );
});

test('stdin port errors become a machine-readable CLI failure without handler calls', async () => {
  let calls = 0;
  let readCalls = 0;
  const registry = fixture(async () => {
    calls += 1;
    return {};
  });
  const result = await invoke(
    registry,
    ['--mode', 'local', 'cli.test:run@1', '--input-json', '-'],
    { authorize: () => true },
    async () => {
      readCalls += 1;
      throw new Error('stdin transport detail');
    },
  );
  assert.equal(readCalls, 1);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).result.kind, 'failure');
  assert.equal(JSON.parse(result.stdout).result.reason, '--input-json must contain valid JSON');
  assert.equal(result.stderr.includes('stdin transport detail'), false);
  assert.equal(calls, 0);
});

test('CLI help hides protected metadata by default and applies surface policy for explicit listings', async () => {
  const input = fromZod(z.object({ accountId: z.string() }));
  const output = fromZod(z.object({ ok: z.boolean() }));
  const publicDefinition = defineCapability({
    identity: { namespace: 'cli.policy', name: 'status', majorVersion: 1 },
    description: 'Public status.',
    input: fromZod(z.object({})),
    output,
    risk: 'read',
    access: { kind: 'public' },
  });
  const protectedDefinition = defineCapability({
    identity: { namespace: 'cli.policy', name: 'account.read', majorVersion: 1 },
    description: 'PRIVATE_ACCOUNT_READ_SENTINEL',
    input,
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['account:read'] },
  });
  const destructiveDefinition = defineCapability({
    identity: { namespace: 'cli.policy', name: 'account.delete', majorVersion: 1 },
    description: 'PRIVATE_ACCOUNT_DELETE_SENTINEL',
    input,
    output,
    risk: 'destructive',
    access: { kind: 'protected', scopes: ['account:delete'] },
  });
  const unboundDefinition = defineCapability({
    identity: { namespace: 'cli.policy', name: 'unbound.read', majorVersion: 1 },
    description: 'PRIVATE_UNBOUND_SENTINEL',
    input,
    output,
    risk: 'read',
    access: { kind: 'protected', scopes: ['account:read'] },
  });
  let destructiveCalls = 0;
  const definitions = [
    publicDefinition,
    protectedDefinition,
    destructiveDefinition,
    unboundDefinition,
  ];
  const bindings = definitions
    .filter((definition) => definition !== unboundDefinition)
    .map((definition) =>
      bindCapability(definition, {
        id: 'binding-' + definition.identity.name,
        targets: ['local'],
        execute: async () => {
          if (definition === destructiveDefinition) destructiveCalls += 1;
          return { ok: true };
        },
      }),
    );
  const registry = createCapabilityRegistry(definitions, bindings);

  const defaultHelp = await invoke(registry, ['--help']);
  assert.match(defaultHelp.stdout, /Public status\./);
  assert.equal(defaultHelp.stdout.includes('PRIVATE_ACCOUNT_READ_SENTINEL'), false);
  assert.equal(defaultHelp.stdout.includes('PRIVATE_ACCOUNT_DELETE_SENTINEL'), false);
  assert.equal(defaultHelp.stdout.includes('PRIVATE_UNBOUND_SENTINEL'), false);

  const hiddenSpecific = await invoke(registry, ['cli.policy:account.read@1', '--help']);
  assert.equal(hiddenSpecific.stdout, 'Capability is unavailable or not visible.\n');

  const scopedHelp = await runCapabilityCliForHelp(registry, ['--help'], {
    canDiscover: (definition) => definition.identity.name === 'account.read',
  });
  assert.equal(scopedHelp.includes('PRIVATE_ACCOUNT_READ_SENTINEL'), true);
  assert.equal(scopedHelp.includes('PRIVATE_ACCOUNT_DELETE_SENTINEL'), false);
  assert.equal(scopedHelp.includes('PRIVATE_UNBOUND_SENTINEL'), false);

  const destructiveHelp = await runCapabilityCliForHelp(registry, ['--help'], {
    canDiscover: () => true,
    surfaceExposure: { cli: { destructive: ['cli.policy:account.delete@1'] } },
  });
  assert.equal(destructiveHelp.includes('PRIVATE_ACCOUNT_DELETE_SENTINEL'), true);

  let stdout = '';
  let stderr = '';
  const deniedCode = await runCapabilityCli(
    ['--mode', 'local', 'cli.policy:account.delete@1', '--account-id', 'account-a'],
    {
      registry,
      caller: { kind: 'authenticated', subject: 'caller', scopes: ['account:delete'] },
      authorization: { authorize: () => true },
    },
    {
      writeStdout: (value) => {
        stdout += value;
      },
      writeStderr: (value) => {
        stderr += value;
      },
    },
  );
  assert.equal(deniedCode, 1);
  assert.equal(JSON.parse(stdout).result.reason, 'capability-unavailable');
  assert.equal(destructiveCalls, 0);

  stdout = '';
  const allowedCode = await runCapabilityCli(
    ['--mode', 'local', 'cli.policy:account.delete@1', '--account-id', 'account-a'],
    {
      registry,
      caller: { kind: 'authenticated', subject: 'caller', scopes: ['account:delete'] },
      authorization: { authorize: () => true },
      surfaceExposure: { cli: { destructive: ['cli.policy:account.delete@1'] } },
    },
    {
      writeStdout: (value) => {
        stdout += value;
      },
      writeStderr() {},
    },
  );
  assert.equal(allowedCode, 0);
  assert.equal(destructiveCalls, 1);

  const unboundHelp = await invoke(registry, ['cli.policy:unbound.read@1', '--help']);
  assert.equal(unboundHelp.stdout, 'Capability is unavailable or not visible.\n');
});

async function runCapabilityCliForHelp(registry, argv, policy) {
  let stdout = '';
  const code = await runCapabilityCli(
    argv,
    {
      registry,
      authorization: { authorize: () => false },
      caller: { kind: 'anonymous' },
      ...policy,
    },
    {
      writeStdout(value) {
        stdout += value;
      },
      writeStderr() {},
    },
  );
  assert.equal(code, 0);
  return stdout;
}
