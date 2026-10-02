import * as z from 'zod';
import type { SchemaPort } from '../core/schema.js';

export function fromZod<Schema extends z.ZodType>(schema: Schema): SchemaPort<z.output<Schema>> {
  return Object.freeze({
    parse(input: unknown): z.output<Schema> {
      return schema.parse(input);
    },
    toJSONSchema(): Readonly<Record<string, unknown>> {
      return z.toJSONSchema(schema, { unrepresentable: 'throw' });
    },
  });
}
