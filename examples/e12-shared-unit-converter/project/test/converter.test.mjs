import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as z from 'zod';
import {
  bindCapability,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import {
  convertDistanceCapability,
  browserConversionBinding,
  conversionHttpHandler,
  localConversionBinding,
  publicReadAuthorization,
  runConversion,
  serverConversionBinding,
} from '../src/converter.mjs';

const invokeUrl =
  'http://converter.test/agent-native/v1/capabilities/example/distance.convert/v1/invoke';
async function invokeHttp(input) {
  return conversionHttpHandler(
    new Request(invokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

const fixtures = JSON.parse(
  await readFile(new URL('../fixtures/conversions.json', import.meta.url), 'utf8'),
);

test('executes conversion fixtures through the selected local binding', async () => {
  for (const fixture of fixtures) {
    for (const [runtime, binding] of [
      ['local', localConversionBinding],
      ['browser', browserConversionBinding],
      ['server', serverConversionBinding],
    ]) {
      const result = await runConversion(fixture.input, runtime);
      assert.equal(result.kind, 'success');
      if (result.kind === 'success') {
        assert.equal(result.bindingId, binding.id);
        assert.deepEqual(result.value, fixture.output);
        assert.deepEqual(convertDistanceCapability.output.parse(result.value), fixture.output);
      }
    }
  }
});

test('fails closed on invalid input before calling a binding', async () => {
  for (const runtime of ['local', 'browser', 'server']) {
    const result = await runConversion({ value: 2, from: 'mi', to: 'cm' }, runtime);

    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') {
      assert.equal(result.reason, 'invalid-input');
      assert.equal(result.observation.status, 'failed');
    }
  }
  assert.throws(
    () => convertDistanceCapability.input.parse({ value: 2, from: 'mi', to: 'cm' }),
    z.ZodError,
  );
});

test('rejects non-finite values through the input contract', async () => {
  for (const value of [Number.POSITIVE_INFINITY, Number.NaN]) {
    for (const runtime of ['local', 'browser', 'server']) {
      const result = await runConversion({ value, from: 'cm', to: 'in' }, runtime);
      assert.equal(result.kind, 'failure');
      if (result.kind === 'failure') {
        assert.equal(result.reason, 'invalid-input');
      }
    }
  }
});

test('local, browser and server bindings report equivalent invalid input and output contract failures', async () => {
  const invalidInputs = [];
  for (const runtime of ['local', 'browser', 'server']) {
    invalidInputs.push(await runConversion({ value: 2, from: 'mi', to: 'cm' }, runtime));
  }
  assert.deepEqual(
    invalidInputs.map(({ kind, reason }) => ({ kind, reason })),
    [
      { kind: 'failure', reason: 'invalid-input' },
      { kind: 'failure', reason: 'invalid-input' },
      { kind: 'failure', reason: 'invalid-input' },
    ],
  );

  const invalidBindings = ['local', 'browser', 'server'].map((runtime) =>
    bindCapability(convertDistanceCapability, {
      id: `invalid-${runtime}-converter`,
      targets: [runtime],
      execute: async () => ({ value: 1, unit: 'unsupported' }),
    }),
  );
  const invalidRegistry = createCapabilityRegistry([convertDistanceCapability], invalidBindings);
  const failures = [];
  for (const runtime of ['local', 'browser', 'server']) {
    failures.push(
      await executeCapability(invalidRegistry, {
        identity: convertDistanceCapability.identity,
        runtime,
        input: { value: 1, from: 'cm', to: 'in' },
        caller: { kind: 'anonymous' },
        authorization: publicReadAuthorization,
      }),
    );
  }
  assert.deepEqual(
    failures.map(({ kind, reason }) => ({ kind, reason })),
    [
      { kind: 'failure', reason: 'invalid-output' },
      { kind: 'failure', reason: 'invalid-output' },
      { kind: 'failure', reason: 'invalid-output' },
    ],
  );
});

test('the server HTTP route agrees with local and browser bindings', async () => {
  for (const fixture of fixtures) {
    const response = await invokeHttp(fixture.input);
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.deepEqual(value, fixture.output);
    for (const runtime of ['local', 'browser']) {
      const result = await runConversion(fixture.input, runtime);
      assert.equal(result.kind, 'success');
      if (result.kind === 'success') assert.deepEqual(result.value, value);
    }
  }
  const invalid = await invokeHttp({ value: 2, from: 'mi', to: 'cm' });
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, 'invalid_input');
});
