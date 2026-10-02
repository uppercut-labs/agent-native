import type { CapabilityDefinition } from './contracts.js';
import type { BindingExecutionContext, CapabilityBinding } from './registry.js';

export type BindingRecord = {
  readonly definition: CapabilityDefinition<unknown, unknown>;
  readonly handler: (input: unknown, context: BindingExecutionContext) => Promise<unknown>;
};

const bindingRecords: WeakMap<CapabilityBinding, BindingRecord> = new WeakMap();

export function setBindingRecord(binding: CapabilityBinding, record: BindingRecord): void {
  bindingRecords.set(binding, record);
}

export function getBindingRecord(binding: CapabilityBinding): BindingRecord | undefined {
  return bindingRecords.get(binding);
}

export async function invokeBindingHandler(
  binding: CapabilityBinding,
  input: unknown,
  context: BindingExecutionContext,
): Promise<unknown> {
  const record = bindingRecords.get(binding);
  if (record === undefined) {
    throw new TypeError('binding was not created by bindCapability');
  }
  return await record.handler(input, context);
}
