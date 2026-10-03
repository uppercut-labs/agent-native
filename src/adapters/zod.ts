import * as z from 'zod';
import { cloneJsonValue, type SchemaPort } from '../core/schema.js';

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function fromZod<Schema extends z.ZodType>(schema: Schema): SchemaPort<z.output<Schema>> {
  return Object.freeze({
    parse(input: unknown): z.output<Schema> {
      return schema.parse(input);
    },
    toJSONSchema(): Readonly<Record<string, unknown>> {
      const converted = cloneJsonValue(
        z.toJSONSchema(schema, { unrepresentable: 'throw' }),
        'JSON Schema',
      );
      if (isReadonlyArray(converted) || converted === null || typeof converted !== 'object') {
        throw new TypeError('Zod schema must convert to a JSON Schema object');
      }
      return converted;
    },
  });
}
