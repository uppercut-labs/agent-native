import type {
  CapabilityAccessRule,
  CapabilityDefinition,
  CapabilityIdentity,
  CapabilityRisk,
} from './contracts.js';
import { canonicalCapabilityId, isValidCapabilityIdentity } from './contracts.js';
import { invokeBindingHandler } from './binding-internal.js';
import type {
  CapabilityBinding,
  CapabilityRegistry,
  ExecutionSignal,
  RuntimeTarget,
} from './registry.js';
import { createDiagnosticObservation, type DiagnosticObservation } from './diagnostics.js';

export type ExecutionCaller =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: 'authenticated';
      readonly subject: string;
      readonly scopes: readonly string[];
    };

export type AuthorizationRequest = {
  readonly identity: CapabilityIdentity;
  readonly risk: CapabilityRisk;
  readonly access: CapabilityAccessRule;
  readonly caller: ExecutionCaller;
  readonly input: unknown;
};

export interface AuthorizationPort {
  authorize(request: AuthorizationRequest): boolean | Promise<boolean>;
}

export type ExecuteCapabilityRequest = {
  readonly identity: CapabilityIdentity;
  readonly runtime: RuntimeTarget;
  readonly input: unknown;
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
  readonly bindingId?: string;
  readonly signal?: ExecutionSignal;
};

export type ExecutionFailureKind =
  | 'invalid-identity'
  | 'capability-missing'
  | 'binding-unavailable'
  | 'binding-ambiguous'
  | 'invalid-input'
  | 'unauthorized'
  | 'authorization-error'
  | 'invalid-output'
  | 'handler-failed'
  | 'deadline-exceeded';

export type ExecutionFailure = {
  readonly kind: 'failure';
  readonly reason: ExecutionFailureKind;
  readonly observation: DiagnosticObservation;
};

export type ExecutionSuccess = {
  readonly kind: 'success';
  readonly capabilityId: string;
  readonly bindingId: string;
  readonly value: unknown;
};

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

function failure(reason: ExecutionFailureKind, suffix: string): ExecutionFailure {
  return Object.freeze({
    kind: 'failure',
    reason,
    observation: createDiagnosticObservation({
      checkId: `UAN-002.${suffix}`,
      status: 'failed',
    }),
  });
}

function isAborted(signal: ExecutionSignal | undefined): boolean {
  return signal?.aborted === true;
}

function findDefinition(
  registry: CapabilityRegistry,
  capabilityId: string,
): CapabilityDefinition<unknown, unknown> | undefined {
  return registry.definitions.find(
    (definition: CapabilityDefinition<unknown, unknown>): boolean =>
      canonicalCapabilityId(definition.identity) === capabilityId,
  );
}

export async function executeCapability(
  registry: CapabilityRegistry,
  request: ExecuteCapabilityRequest,
): Promise<ExecutionResult> {
  if (!isValidCapabilityIdentity(request.identity)) {
    return failure('invalid-identity', 'invalid-identity');
  }
  const capabilityId: string = canonicalCapabilityId(request.identity);
  const definition: CapabilityDefinition<unknown, unknown> | undefined = findDefinition(
    registry,
    capabilityId,
  );
  if (definition === undefined) {
    return failure('capability-missing', 'capability-missing');
  }

  const availableBindings: readonly CapabilityBinding[] = registry.bindings.filter(
    (binding: CapabilityBinding): boolean =>
      binding.capabilityId === capabilityId && binding.targets.includes(request.runtime),
  );
  const selectedBindings: readonly CapabilityBinding[] =
    request.bindingId === undefined
      ? availableBindings
      : availableBindings.filter(
          (binding: CapabilityBinding): boolean => binding.id === request.bindingId,
        );
  if (selectedBindings.length === 0) {
    return failure('binding-unavailable', 'binding-unavailable');
  }
  if (selectedBindings.length > 1) {
    return failure('binding-ambiguous', 'binding-ambiguous');
  }
  const binding: CapabilityBinding | undefined = selectedBindings[0];
  if (binding === undefined) {
    return failure('binding-unavailable', 'binding-unavailable');
  }

  let parsedInput: unknown;
  try {
    parsedInput = definition.input.parse(request.input);
  } catch {
    return failure('invalid-input', 'invalid-input');
  }

  let authorized: boolean;
  try {
    authorized = await request.authorization.authorize({
      identity: definition.identity,
      risk: definition.risk,
      access: definition.access,
      caller: request.caller,
      input: parsedInput,
    });
  } catch {
    return failure('authorization-error', 'authorization-error');
  }
  if (!authorized) {
    return failure('unauthorized', 'unauthorized');
  }
  if (isAborted(request.signal)) {
    return failure('deadline-exceeded', 'deadline-exceeded');
  }

  let rawOutput: unknown;
  try {
    rawOutput = await invokeBindingHandler(binding, parsedInput, {
      capabilityId,
      runtime: request.runtime,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch {
    return failure('handler-failed', 'handler-failed');
  }
  if (isAborted(request.signal)) {
    return failure('deadline-exceeded', 'deadline-exceeded');
  }

  let output: unknown;
  try {
    output = definition.output.parse(rawOutput);
  } catch {
    return failure('invalid-output', 'invalid-output');
  }
  return Object.freeze({
    kind: 'success',
    capabilityId,
    bindingId: binding.id,
    value: output,
  });
}
