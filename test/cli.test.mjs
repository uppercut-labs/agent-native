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

test('non-JSON handler output is replaced by a valid failure envelope', async () => {
  for (const value of [1n, Number.POSITIVE_INFINITY]) {
    const registry = fixture(async () => value);
    const result = await invoke(registry, ['--mode', 'local', 'cli.test:run@1', '--text', 'hello']);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout).result, {
      kind: 'failure',
      reason: 'result-serialization-failed',
    });
  }
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

test('CLI command and alias overrides resolve to the canonical capability', async () => {
  const definition = defineCapability({
    identity: { namespace: 'content', name: 'search', majorVersion: 1 },
    description: 'Search public content.',
    input: fromZod(z.object({ query: z.string().min(1), limit: z.number().int().optional() })),
    output: fromZod(z.object({ query: z.string(), count: z.number().int() })),
    risk: 'read',
    access: { kind: 'public' },
    surfaces: { cli: { command: 'content-search', aliases: ['search'] } },
  });
  const binding = bindCapability(definition, {
    id: 'content-search',
    targets: ['local'],
    execute: async ({ query, limit = 5 }) => ({ query, count: limit }),
  });
  const registry = createCapabilityRegistry([definition], [binding]);

  for (const command of ['content-search', 'search']) {
    const result = await invoke(registry, [
      '--mode',
      'local',
      command,
      '--query',
      'night',
      '--limit',
      '1',
    ]);
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).result.capabilityId, 'content:search@1');
    assert.deepEqual(JSON.parse(result.stdout).result.value, { query: 'night', count: 1 });
  }

  const invalid = await invoke(registry, [
    '--mode',
    'local',
    'search',
    '--input-json',
    '{"query":""}',
  ]);
  assert.equal(invalid.code, 2);
  assert.equal(JSON.parse(invalid.stdout).result.reason, 'invalid-input');
});

test('CLI rejects duplicate commands and aliases before execution', async () => {
  const definitions = ['first', 'second'].map((name, index) =>
    defineCapability({
      identity: { namespace: 'duplicate.cli', name, majorVersion: 1 },
      description: 'Duplicate CLI fixture.',
      input: fromZod(z.object({})),
      output: fromZod(z.object({ ok: z.boolean() })),
      risk: 'read',
      access: { kind: 'public' },
      surfaces: {
        cli: { command: index === 0 ? 'first-command' : 'second-command', aliases: ['shared'] },
      },
    }),
  );
  let calls = 0;
  const bindings = definitions.map((definition, index) =>
    bindCapability(definition, {
      id: `duplicate-cli-${index}`,
      targets: ['local'],
      execute: async () => {
        calls += 1;
        return { ok: true };
      },
    }),
  );
  const result = await invoke(createCapabilityRegistry(definitions, bindings), [
    '--mode',
    'local',
    'shared',
  ]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).result.reason, 'invalid-cli-surfaces');
  assert.equal(calls, 0);
});

test('remote CLI follows GET override and retains canonical invocation', async () => {
  const definition = defineCapability({
    identity: { namespace: 'content', name: 'search', majorVersion: 1 },
    description: 'Search public content.',
    input: fromZod(z.object({ query: z.string().min(1), limit: z.number().int().optional() })),
    output: fromZod(z.object({ query: z.string(), count: z.number().int() })),
    risk: 'read',
    access: { kind: 'public' },
    surfaces: {
      http: { path: '/api/content/search', method: 'GET', query: { query: 'q' } },
      cli: { command: 'content-search', aliases: ['search'] },
    },
  });
  const binding = bindCapability(definition, {
    id: 'content-search-remote',
    targets: ['server'],
    execute: async () => ({ query: 'unused', count: 0 }),
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  let calls = 0;
  for (const command of ['search', 'content:search@1']) {
    let stdout = '';
    const code = await runCapabilityCli(
      [command, '--mode', 'remote', '--profile', 'test', '--query', 'night', '--limit', '1'],
      {
        registry,
        caller: { kind: 'anonymous' },
        authorization: { authorize: () => true },
        credentialProfiles: { test: { baseUrl: 'http://127.0.0.1:9999', token: 'fixture' } },
        fetcher: async (url, init) => {
          calls += 1;
          assert.equal(url.pathname, '/api/content/search');
          assert.equal(url.searchParams.get('q'), 'night');
          assert.equal(url.searchParams.get('limit'), '1');
          assert.equal(init.method, 'GET');
          assert.equal(init.body, undefined);
          return Response.json({ query: 'night', count: 1 });
        },
      },
      {
        writeStdout(value) {
          stdout += value;
        },
        writeStderr() {},
      },
    );
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout).result.value, { query: 'night', count: 1 });
  }
  assert.equal(calls, 2);

  let invalidOutput = '';
  const invalidCode = await runCapabilityCli(
    ['search', '--mode', 'remote', '--profile', 'test', '--query', ''],
    {
      registry,
      caller: { kind: 'anonymous' },
      authorization: { authorize: () => true },
      credentialProfiles: { test: { baseUrl: 'http://127.0.0.1:9999', token: 'fixture' } },
      fetcher: async () => {
        throw new Error('invalid input reached network');
      },
    },
    {
      writeStdout(value) {
        invalidOutput += value;
      },
      writeStderr() {},
    },
  );
  assert.equal(invalidCode, 2);
  assert.equal(JSON.parse(invalidOutput).result.reason, 'invalid-input');
});

test('remote CLI refuses protected writes before network effects', async () => {
  const definition = defineCapability({
    identity: { namespace: 'cli.test', name: 'write-once', majorVersion: 1 },
    description: 'Write exposure fixture.',
    input: fromZod(z.object({ value: z.string() })),
    output: fromZod(z.object({ saved: z.boolean() })),
    risk: 'write',
    access: { kind: 'protected', scopes: ['fixture:write'] },
  });
  let bindingCalls = 0;
  const registry = createCapabilityRegistry(
    [definition],
    [
      bindCapability(definition, {
        id: 'remote-write',
        targets: ['server'],
        execute: async () => {
          bindingCalls += 1;
          return { saved: true };
        },
      }),
    ],
  );
  let fetchCalls = 0;
  let stdout = '';
  const code = await runCapabilityCli(
    [
      '--mode',
      'remote',
      '--profile',
      'fixture',
      'cli.test:write-once@1',
      '--input-json',
      '{"value":"only-once"}',
    ],
    {
      registry,
      authorization: { authorize: () => true },
      caller: { kind: 'authenticated', subject: 'fixture', scopes: ['fixture:write'] },
      credentialProfiles: { fixture: { baseUrl: 'https://fixture.test', token: 'fake-token' } },
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error('must not be called');
      },
    },
    {
      writeStdout: (value) => {
        stdout += value;
      },
      writeStderr: () => {},
    },
  );
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).result.reason, 'capability-unavailable');
  assert.equal(fetchCalls, 0);
  assert.equal(bindingCalls, 0);
});
