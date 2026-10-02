export interface SchemaPort<Value> {
  parse(input: unknown): Value;
  toJSONSchema(): Readonly<Record<string, unknown>>;
}
