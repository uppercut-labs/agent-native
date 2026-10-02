import type { JsonSchemaType } from '@modelcontextprotocol/server';
import * as z from 'zod';

type IsAny<Value> = 0 extends 1 & Value ? true : false;
type Expect<Condition extends true> = Condition;

export type UpstreamDefaultUsesAny = Expect<IsAny<JsonSchemaType['default']>>;

export function parseSdkSchemaDefault(schema: JsonSchemaType): string {
  const untrustedDefault: unknown = schema.default;
  return z.string().parse(untrustedDefault);
}
