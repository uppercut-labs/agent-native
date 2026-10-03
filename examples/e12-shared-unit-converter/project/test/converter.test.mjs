import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as z from 'zod';
import {
  convertDistanceCapability,
  browserConversionBinding,
  localConversionBinding,
  runConversion,
} from '../src/converter.mjs';

const fixtures = JSON.parse(
  await readFile(new URL('../fixtures/conversions.json', import.meta.url), 'utf8'),
);

test('executes conversion fixtures through the selected local binding', async () => {
  for (const fixture of fixtures) {
    for (const [runtime, binding] of [
      ['local', localConversionBinding],
      ['browser', browserConversionBinding],
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
  for (const runtime of ['local', 'browser']) {
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
    for (const runtime of ['local', 'browser']) {
      const result = await runConversion({ value, from: 'cm', to: 'in' }, runtime);
      assert.equal(result.kind, 'failure');
      if (result.kind === 'failure') {
        assert.equal(result.reason, 'invalid-input');
      }
    }
  }
});
