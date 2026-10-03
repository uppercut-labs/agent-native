import type { CapabilityDefinition } from './contracts.js';
import { canonicalCapabilityId, isCapabilityDefinition } from './contracts.js';
import { createDiagnosticObservation, type DiagnosticObservation } from './diagnostics.js';
import { getBindingRecord, setBindingRecord } from './binding-internal.js';

export type RuntimeTarget = 'browser' | 'server' | 'local';

export type ExecutionSignal = {
  readonly aborted: boolean;
};

export type BindingExecutionContext = {
  readonly capabilityId: string;
  readonly runtime: RuntimeTarget;
  readonly signal?: ExecutionSignal;
};

export type CapabilityBindingOptions<Input, Output> = {
  readonly id: string;
  readonly targets: readonly RuntimeTarget[];
  readonly execute: (input: Input, context: BindingExecutionContext) => Output | Promise<Output>;
};

export type CapabilityBinding = {
  readonly id: string;
  readonly capabilityId: string;
  readonly targets: readonly RuntimeTarget[];
};

export type RegistryErrorKind = 'invalid-definition' | 'duplicate-definition' | 'invalid-binding';

export class CapabilityRegistryError extends Error {
  public readonly kind: RegistryErrorKind;
  public readonly observation: DiagnosticObservation;

  public constructor(kind: RegistryErrorKind, message: string, checkId: string) {
    super(message);
    this.name = 'CapabilityRegistryError';
    this.kind = kind;
    this.observation = createDiagnosticObservation({ checkId, status: 'failed' });
  }
}

export type CapabilityRegistry = {
  readonly definitions: readonly CapabilityDefinition<unknown, unknown>[];
  readonly bindings: readonly CapabilityBinding[];
};

export function bindCapability<Input, Output>(
  definition: CapabilityDefinition<Input, Output>,
  options: CapabilityBindingOptions<Input, Output>,
): CapabilityBinding {
  const capabilityId = canonicalCapabilityId(definition.identity);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(options.id)) {
    throw new TypeError('binding id must be a lowercase slug');
  }
  if (
    options.targets.length === 0 ||
    options.targets.some((target) => !['browser', 'server', 'local'].includes(target))
  ) {
    throw new TypeError('binding targets must name one or more supported runtimes');
  }

  const targets: readonly RuntimeTarget[] = Object.freeze([...new Set(options.targets)]);
  const binding: CapabilityBinding = Object.freeze({
    id: options.id,
    capabilityId,
    targets,
  });
  setBindingRecord(binding, {
    definition,
    async handler(input: unknown, context: BindingExecutionContext): Promise<unknown> {
      const parsed: Input = input as Input;
      return await options.execute(parsed, context);
    },
  });
  return binding;
}

export function createCapabilityRegistry(
  definitions: readonly CapabilityDefinition<unknown, unknown>[],
  bindings: readonly CapabilityBinding[],
): CapabilityRegistry {
  const definitionIds: Set<string> = new Set();
  const definitionsById: Map<string, CapabilityDefinition<unknown, unknown>> = new Map();
  for (const candidate of definitions) {
    if (!isCapabilityDefinition(candidate)) {
      throw new CapabilityRegistryError(
        'invalid-definition',
        'registry definition must include valid identity, schemas, risk, and access metadata',
        'UAN-002.invalid-definition',
      );
    }
    const definition = candidate;
    let id: string;
    try {
      id = canonicalCapabilityId(definition.identity);
    } catch {
      throw new CapabilityRegistryError(
        'invalid-definition',
        'registry contains an invalid capability identity',
        'UAN-002.invalid-definition',
      );
    }
    if (definitionIds.has(id)) {
      throw new CapabilityRegistryError(
        'duplicate-definition',
        `registry contains duplicate identity ${id}`,
        'UAN-002.duplicate-definition',
      );
    }
    definitionIds.add(id);
    definitionsById.set(id, definition);
  }

  const bindingIds: Set<string> = new Set();
  for (const binding of bindings) {
    const registeredDefinition = definitionsById.get(binding.capabilityId);
    const boundDefinition = getBindingRecord(binding)?.definition;
    if (
      registeredDefinition === undefined ||
      boundDefinition !== registeredDefinition ||
      bindingIds.has(binding.id)
    ) {
      throw new CapabilityRegistryError(
        'invalid-binding',
        'binding must target a registered definition and have a unique id',
        'UAN-002.invalid-binding',
      );
    }
    bindingIds.add(binding.id);
  }

  return Object.freeze({
    definitions: Object.freeze([...definitions]),
    bindings: Object.freeze([...bindings]),
  });
}
