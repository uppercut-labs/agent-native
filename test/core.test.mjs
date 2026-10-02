import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { test } from 'node:test';
import {
  createDiagnosticObservation,
  defineCapability,
  DIAGNOSTIC_OBSERVATION_JSON_SCHEMA,
} from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';

const albumLookupInput = fromZod(
  z.object({
    slug: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional(),
  }),
);
const albumLookupOutput = fromZod(
  z.object({
    slug: z.string().min(1),
    title: z.string().min(1),
    artist: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
  }),
);
const converterInput = fromZod(
  z.object({
    value: z.number(),
    from: z.enum(['cm', 'in']),
    to: z.enum(['cm', 'in']),
  }),
);
const converterOutput = fromZod(
  z.object({
    value: z.number(),
    unit: z.enum(['cm', 'in']),
  }),
);

function compileExportedSchema(schemaPort) {
  const validator = new Ajv2020({ allErrors: true }).compile(schemaPort.toJSONSchema());
  return (value) => validator(value);
}

const exportedValidators = {
  albumInput: compileExportedSchema(albumLookupInput),
  albumOutput: compileExportedSchema(albumLookupOutput),
  converterInput: compileExportedSchema(converterInput),
  converterOutput: compileExportedSchema(converterOutput),
};

test('album lookup input parses and its exported schema validates independently', () => {
  const value = { slug: 'midnight-records', limit: 10 };

  assert.deepEqual(albumLookupInput.parse(value), value);
  assert.equal(exportedValidators.albumInput(value), true);
});

test('album lookup input rejects bad parser and exported-schema fixtures', () => {
  for (const value of [{ slug: '' }, { slug: 'midnight-records', limit: 0 }]) {
    assert.throws(() => albumLookupInput.parse(value), z.ZodError);
    assert.equal(exportedValidators.albumInput(value), false);
  }
});

test('album lookup output parses and its exported schema validates independently', () => {
  const value = {
    slug: 'midnight-records',
    title: 'Midnight Records',
    artist: 'The Example Band',
    year: 2024,
  };

  assert.deepEqual(albumLookupOutput.parse(value), value);
  assert.equal(exportedValidators.albumOutput(value), true);
});

test('album lookup output rejects bad parser and exported-schema fixtures', () => {
  for (const value of [
    { slug: 'midnight-records', title: '', artist: 'The Example Band', year: 2024 },
    { slug: 'midnight-records', title: 'Midnight Records', artist: 'The Example Band', year: 1800 },
  ]) {
    assert.throws(() => albumLookupOutput.parse(value), z.ZodError);
    assert.equal(exportedValidators.albumOutput(value), false);
  }
});

test('unit converter input parses and its exported schema validates independently', () => {
  const value = { value: 12, from: 'in', to: 'cm' };

  assert.deepEqual(converterInput.parse(value), value);
  assert.equal(exportedValidators.converterInput(value), true);
});

test('unit converter input rejects bad parser and exported-schema fixtures', () => {
  for (const value of [
    { value: '12', from: 'in', to: 'cm' },
    { value: 12, from: 'mi', to: 'cm' },
  ]) {
    assert.throws(() => converterInput.parse(value), z.ZodError);
    assert.equal(exportedValidators.converterInput(value), false);
  }
});

test('unit converter output parses and its exported schema validates independently', () => {
  const value = { value: 30.48, unit: 'cm' };

  assert.deepEqual(converterOutput.parse(value), value);
  assert.equal(exportedValidators.converterOutput(value), true);
});

test('unit converter output rejects bad parser and exported-schema fixtures', () => {
  for (const value of [
    { value: '30.48', unit: 'cm' },
    { value: 30.48, unit: 'yd' },
  ]) {
    assert.throws(() => converterOutput.parse(value), z.ZodError);
    assert.equal(exportedValidators.converterOutput(value), false);
  }
});

test('rejects schemas whose transforms cannot be represented faithfully', () => {
  const transformed = fromZod(z.string().transform((value) => value.length));

  assert.throws(() => transformed.toJSONSchema(), /transforms/i);
});

test('defines immutable identities and rejects invalid major versions', () => {
  const capability = defineCapability({
    identity: { namespace: 'catalog', name: 'album.lookup', majorVersion: 1 },
    description: 'Find an album by slug.',
    input: albumLookupInput,
    output: albumLookupOutput,
  });

  assert.equal(Object.isFrozen(capability), true);
  assert.equal(Object.isFrozen(capability.identity), true);
  assert.throws(
    () =>
      defineCapability({
        identity: { namespace: 'catalog', name: 'album.lookup', majorVersion: 0 },
        description: 'Find an album by slug.',
        input: albumLookupInput,
        output: albumLookupOutput,
      }),
    RangeError,
  );
});

test('serializes passed, failed, and unknown observations without payload fields', () => {
  const validateObservation = new Ajv2020({ allErrors: true }).compile(
    DIAGNOSTIC_OBSERVATION_JSON_SCHEMA,
  );

  for (const status of ['passed', 'failed', 'unknown']) {
    const observation = createDiagnosticObservation({
      checkId: 'UAN-001.schema-spike',
      status,
      evidenceRefs: ['E-UAN-001-01'],
    });
    const serialized = JSON.parse(JSON.stringify(observation));

    assert.deepEqual(serialized, {
      checkId: 'UAN-001.schema-spike',
      status,
      evidenceRefs: ['E-UAN-001-01'],
    });
    assert.deepEqual(Object.keys(serialized).sort(), ['checkId', 'evidenceRefs', 'status']);
    assert.equal(validateObservation(serialized), true);
  }

  assert.equal(
    validateObservation({
      checkId: 'UAN-001.schema-spike',
      status: 'pending',
      evidenceRefs: [],
    }),
    false,
  );

  assert.throws(
    () => createDiagnosticObservation({ checkId: 'bad-id', status: 'failed' }),
    TypeError,
  );
  assert.throws(
    () =>
      createDiagnosticObservation({
        checkId: 'UAN-001.schema-spike',
        status: 'passed',
        evidenceRefs: ['user@example.com'],
      }),
    TypeError,
  );
});

test('contract entrypoint imports without Node or DOM globals', async () => {
  const originalDocument = globalThis.document;
  const originalProcess = globalThis.process;
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'process');

  try {
    const contracts = await import('../dist/core/contracts.js');
    assert.equal(typeof contracts.defineCapability, 'function');
  } finally {
    if (originalDocument !== undefined) {
      Object.defineProperty(globalThis, 'document', {
        value: originalDocument,
        configurable: true,
      });
    }
    if (originalProcess !== undefined) {
      Object.defineProperty(globalThis, 'process', { value: originalProcess, configurable: true });
    }
  }
});
