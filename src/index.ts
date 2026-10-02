export {
  CapabilityDefinitionError,
  canonicalCapabilityId,
  defineCapability,
  isValidCapabilityIdentity,
} from './core/contracts.js';
export type {
  CapabilityAccessRule,
  CapabilityDefinition,
  CapabilityDefinitionOptions,
  CapabilityIdentity,
  CapabilityRisk,
} from './core/contracts.js';
export { executeCapability } from './core/executor.js';
export type {
  AuthorizationPort,
  AuthorizationRequest,
  ExecutionCaller,
  ExecutionFailure,
  ExecutionFailureKind,
  ExecutionResult,
  ExecutionSuccess,
  ExecuteCapabilityRequest,
} from './core/executor.js';
export {
  CapabilityRegistryError,
  bindCapability,
  createCapabilityRegistry,
} from './core/registry.js';
export type {
  BindingExecutionContext,
  CapabilityBinding,
  CapabilityBindingOptions,
  CapabilityRegistry,
  RegistryErrorKind,
  RuntimeTarget,
} from './core/registry.js';
export {
  createDiagnosticObservation,
  DIAGNOSTIC_OBSERVATION_JSON_SCHEMA,
} from './core/diagnostics.js';
export type {
  DiagnosticObservation,
  DiagnosticObservationOptions,
  DiagnosticStatus,
} from './core/diagnostics.js';
export type { SchemaPort } from './core/schema.js';
