import { defineCapability } from '../src/core/contracts.js';
import type { SchemaPort } from '../src/core/schema.js';

const stringSchema: SchemaPort<string> = {
  parse(input: unknown): string {
    if (typeof input !== 'string') {
      throw new TypeError('Expected string');
    }
    return input;
  },
  toJSONSchema(): Readonly<Record<string, unknown>> {
    return { type: 'string' };
  },
};

export const browserContractImport = defineCapability({
  identity: { namespace: 'example', name: 'lookup', majorVersion: 1 },
  description: 'Look up an item by its identifier.',
  input: stringSchema,
  output: stringSchema,
});
