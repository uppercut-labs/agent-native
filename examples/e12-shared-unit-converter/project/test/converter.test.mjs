import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as z from 'zod';
import { convertDistance, convertDistanceCapability } from '../src/converter.mjs';

const fixtures = JSON.parse(
  await readFile(new URL('../fixtures/conversions.json', import.meta.url), 'utf8'),
);

test('runs the fixed conversion fixtures through the pure capability binding', () => {
  for (const fixture of fixtures) {
    const result = convertDistance(fixture.input);
    assert.deepEqual(result, fixture.output);
    assert.deepEqual(convertDistanceCapability.output.parse(result), fixture.output);
  }
});

test('rejects unsupported units through the contract schema', () => {
  assert.throws(() => convertDistance({ value: 2, from: 'mi', to: 'cm' }), z.ZodError);
});

test('rejects non-finite values through the contract schema', () => {
  assert.throws(
    () => convertDistance({ value: Number.POSITIVE_INFINITY, from: 'in', to: 'cm' }),
    z.ZodError,
  );
  assert.throws(() => convertDistance({ value: Number.NaN, from: 'cm', to: 'in' }), z.ZodError);
});
