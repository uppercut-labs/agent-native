import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { distanceConversion, measurementPack } from '@example/e08-distance-contracts';
import {
  CapabilityCompositionError,
  composeCapabilityPacks,
  createCapabilityRegistry,
  defineCapabilityPack,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { preciseBinding } from '../src/consumer-a.mjs';
import { fixtureBinding } from '../src/consumer-b.mjs';

const imported = {
  pack: measurementPack,
  source: 'test/e08.test.mjs:pack',
  aliasPolicy: { kind: 'none' },
};

test('two consumers bind one imported contract without schema or handler copies', async () => {
  const composition = composeCapabilityPacks([imported]);
  const registry = createCapabilityRegistry(composition.definitions, [
    preciseBinding,
    fixtureBinding,
  ]);
  const base = {
    identity: distanceConversion.identity,
    runtime: 'local',
    input: { value: 2, from: 'in', to: 'cm' },
    caller: { kind: 'authenticated', subject: 'test-user', scopes: ['distance:convert'] },
    authorization: { authorize: () => true },
  };
  const precise = await executeCapability(registry, { ...base, bindingId: 'precise-consumer' });
  const fixture = await executeCapability(registry, { ...base, bindingId: 'fixture-consumer' });

  assert.equal(precise.kind, 'success');
  assert.equal(fixture.kind, 'success');
  if (precise.kind === 'success') {
    assert.equal(precise.value.provider, 'precise-consumer');
    assert.equal(precise.value.value, 5.08);
  }
  if (fixture.kind === 'success') {
    assert.equal(fixture.value.provider, 'fixture-consumer');
    assert.equal(fixture.value.value, 5.08);
  }

  const denied = await executeCapability(registry, {
    ...base,
    bindingId: 'precise-consumer',
    authorization: { authorize: () => false },
  });
  assert.equal(denied.kind, 'failure');
  if (denied.kind === 'failure') assert.equal(denied.reason, 'unauthorized');
});

test('each consumer app imports the packed contract in an independent process', () => {
  for (const [entrypoint, bindingId] of [
    ['demo.mjs', 'precise-consumer'],
    ['demo-b.mjs', 'fixture-consumer'],
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
    assert.equal(output.value.value, 30.48);
  }
});

test('a deliberately conflicting full identity reports both import sites', () => {
  const conflictingPack = defineCapabilityPack({
    identity: { authority: 'example.org', namespace: 'measurement' },
    source: '@example/conflicting-contracts@1.0.0',
    definitions: [distanceConversion],
  });
  assert.throws(
    () =>
      composeCapabilityPacks([
        imported,
        {
          pack: conflictingPack,
          source: 'test/conflict.mjs:7',
          aliasPolicy: { kind: 'none' },
        },
      ]),
    (error) =>
      error instanceof CapabilityCompositionError &&
      /test\/e08\.test\.mjs:pack/.test(error.message) &&
      /test\/conflict\.mjs:7/.test(error.message),
  );
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
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
