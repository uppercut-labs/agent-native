import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import * as z from 'zod';
import { fromZod } from '../dist/adapters/zod.js';
import { cloneJsonValue } from '../dist/core/schema.js';

test('Zod conversion preserves arrays, optional fields, nested objects and named result unions', () => {
  const contract = fromZod(
    z.object({
      tags: z.array(z.string().min(1)),
      page: z.number().int().positive().optional(),
      result: z
        .discriminatedUnion('kind', [
          z.object({
            kind: z.literal('found'),
            item: z.object({ id: z.string(), score: z.number() }),
          }),
          z.object({ kind: z.literal('missing') }),
        ])
        .meta({ id: 'SearchResult' }),
    }),
  );
  const schema = contract.toJSONSchema();
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const values = [
    { tags: ['night'], result: { kind: 'missing' } },
    {
      tags: ['night', 'market'],
      page: 2,
      result: { kind: 'found', item: { id: 'night-market', score: 0.9 } },
    },
  ];

  for (const value of values) {
    assert.deepEqual(contract.parse(value), value);
    assert.equal(validate(value), true);
  }
  assert.equal(Object.isFrozen(schema), true);
  assert.equal(validate({ tags: [], result: { kind: 'found', item: { id: 'x' } } }), false);
});

test('Zod ports reject non-finite numbers, transforms and unsupported conversions', () => {
  const number = fromZod(z.number());
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => number.parse(value), z.ZodError);
  }

  assert.throws(
    () => fromZod(z.string().transform((value) => value.length)).toJSONSchema(),
    /transform/i,
  );
  assert.throws(() => fromZod(z.bigint()).toJSONSchema(), /represent/i);
});

test('JSON clone preserves own __proto__ fields without prototype changes', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const cloned = cloneJsonValue(source);
  assert.equal(Object.getPrototypeOf(cloned), null);
  assert.equal(Object.hasOwn(cloned, '__proto__'), true);
  assert.equal(JSON.stringify(cloned), JSON.stringify(source));
  assert.equal({}.polluted, undefined);
});
