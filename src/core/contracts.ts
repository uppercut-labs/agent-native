import type { SchemaPort } from './schema.js';

export type CapabilityIdentity = {
  readonly namespace: string;
  readonly name: string;
  readonly majorVersion: number;
};

export type CapabilityDefinition<Input, Output> = {
  readonly identity: CapabilityIdentity;
  readonly description: string;
  readonly input: SchemaPort<Input>;
  readonly output: SchemaPort<Output>;
};

export type CapabilityDefinitionOptions<Input, Output> = {
  readonly identity: CapabilityIdentity;
  readonly description: string;
  readonly input: SchemaPort<Input>;
  readonly output: SchemaPort<Output>;
};

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export function defineCapability<Input, Output>(
  options: CapabilityDefinitionOptions<Input, Output>,
): CapabilityDefinition<Input, Output> {
  assertNonEmpty(options.identity.namespace, 'identity.namespace');
  assertNonEmpty(options.identity.name, 'identity.name');
  assertNonEmpty(options.description, 'description');

  if (!Number.isSafeInteger(options.identity.majorVersion) || options.identity.majorVersion < 1) {
    throw new RangeError('identity.majorVersion must be a positive safe integer');
  }

  const identity: CapabilityIdentity = Object.freeze({ ...options.identity });
  return Object.freeze({
    identity,
    description: options.description.trim(),
    input: options.input,
    output: options.output,
  });
}
