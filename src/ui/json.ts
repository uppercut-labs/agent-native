import type { Json, JsonObject } from './types.js';
const RESERVED: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function own(object: object, key: string): boolean {
  return Object.hasOwn(object, key);
}
export function safeKey(key: string): boolean {
  return !RESERVED.has(key);
}
export function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(?:\p{ID_Start}|_)(?:\p{ID_Continue}|_)*$/u.test(value) &&
    safeKey(value)
  );
}
export function boundedString(value: unknown, max: number = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
export function jsonValue(value: unknown, maxDepth: number = 32, depth: number = 0): value is Json {
  if (depth > maxDepth) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= 10000 &&
      value.every((v: unknown): boolean => jsonValue(v, maxDepth, depth + 1))
    );
  if (
    !isObject(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    return false;
  const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(value);
  return Object.entries(descriptors).every(
    ([key, descriptor]: [string, PropertyDescriptor]): boolean =>
      safeKey(key) &&
      descriptor.get === undefined &&
      descriptor.set === undefined &&
      jsonValue(descriptor.value as unknown, maxDepth, depth + 1),
  );
}
export function jsonObject(value: unknown): value is JsonObject {
  return isObject(value) && jsonValue(value);
}
export function clone<T extends Json>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function freezeJson<T extends Json>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
export function byteLength(text: string): number {
  // Portable UTF-8 count without Buffer or DOM globals.
  let length: number = 0;
  for (const character of text) {
    const code: number = character.codePointAt(0) ?? 0;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}
export function pointerParts(path: string): readonly string[] {
  if (path === '' || path === '/') return [];
  if (!path.startsWith('/') || path.length > 2048)
    throw new TypeError('Expected a bounded absolute JSON Pointer.');
  const parts: string[] = path
    .slice(1)
    .split('/')
    .map((part: string): string => {
      if (/~(?:[^01]|$)/.test(part)) throw new TypeError('Invalid JSON Pointer escape.');
      const decoded: string = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!safeKey(decoded)) throw new TypeError('Unsafe JSON Pointer segment.');
      return decoded;
    });
  if (parts.length > 32) throw new TypeError('JSON Pointer is too deep.');
  return parts;
}
export function pointer(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  try {
    pointerParts(path);
    return true;
  } catch {
    return false;
  }
}
export function readAt(root: Json, path: string): Json | undefined {
  let current: Json | undefined = root;
  for (const part of pointerParts(path)) {
    if (current === null || typeof current !== 'object' || !own(current, part)) return undefined;
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part)) return undefined;
      current = current[Number(part)];
    } else current = (current as JsonObject)[part];
  }
  return current;
}
export function writeAt(root: JsonObject, path: string, value: Json | undefined): JsonObject {
  const parts: readonly string[] = pointerParts(path);
  if (parts.length === 0) {
    if (!jsonObject(value)) throw new TypeError('The root data model must be a JSON object.');
    return clone(value);
  }
  let next: Record<string, Json> = clone(root) as Record<string, Json>;
  let current: Record<string, Json> | Json[] = next;
  for (let i: number = 0; i < parts.length; i += 1) {
    const part: string = parts[i] ?? '';
    if (
      Array.isArray(current) &&
      (!/^(0|[1-9][0-9]*)$/.test(part) || Number(part) >= current.length)
    ) {
      throw new TypeError('Array updates must address an existing element.');
    }
    const key: string = part;
    if (i === parts.length - 1) {
      if (Array.isArray(current)) {
        if (value === undefined) current.splice(Number(key), 1);
        else current[Number(key)] = clone(value);
      } else if (value === undefined) delete current[key];
      else current[key] = clone(value);
      return next;
    }
    let child: Json | undefined = Array.isArray(current) ? current[Number(key)] : current[key];
    if (child === undefined) {
      child = {};
      if (Array.isArray(current)) current[Number(key)] = child;
      else current[key] = child;
    }
    if (child === null || typeof child !== 'object')
      throw new TypeError('Cannot traverse a scalar data value.');
    current = child as Record<string, Json> | Json[];
  }
  return next;
}
export function same(a: Json | undefined, b: Json | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v: Json, i: number): boolean => same(v, b[i]))
    );
  const ak: string[] = Object.keys(a).sort();
  const bk: string[] = Object.keys(b).sort();
  return (
    ak.length === bk.length &&
    ak.every(
      (key: string, i: number): boolean =>
        key === bk[i] && same((a as JsonObject)[key], (b as JsonObject)[key]),
    )
  );
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key: string): boolean => keys.includes(key));
}
