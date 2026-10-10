export interface SchemaPort<Value> {
  parse(input: unknown): Value;
  toJSONSchema(): Readonly<Record<string, unknown>>;
}

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function cloneJsonValue(
  value: unknown,
  label: string = 'value',
  seen: Set<object> = new Set(),
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${label} contains a value that cannot be represented as JSON`);
  }
  const prototype: unknown = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new TypeError(`${label} contains a non-JSON object`);
  }
  if (Reflect.ownKeys(value).some((key: string | symbol): boolean => typeof key === 'symbol')) {
    throw new TypeError(`${label} contains a symbol property`);
  }
  if (seen.has(value)) throw new TypeError(`${label} contains a circular reference`);
  seen.add(value);
  let result: JsonValue;
  if (Array.isArray(value)) {
    result = Object.freeze(
      value.map((item: unknown): JsonValue => cloneJsonValue(item, label, seen)),
    );
  } else {
    let copy: Record<string, JsonValue> = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      copy[key] = cloneJsonValue(item, label, seen);
    }
    result = Object.freeze(copy);
  }
  seen.delete(value);
  return result;
}
