export type {
  GrantAuthorizationOptions,
  GrantQuery,
  GrantStorePort,
  PersistedGrant,
  TrustedPrincipal,
} from './auth.js';
export {
  createGrantAuthorization,
  executionCallerForPrincipal,
  hasGrantForScopes,
} from './auth.js';
export type {
  CapabilityAlias,
  CapabilityAliasPolicy,
  CapabilityComposition,
  CapabilityPack,
  CapabilityPackIdentity,
  CapabilityPackImport,
  CapabilityPackOptions,
  CapabilitySurfaceNames,
} from './core/composition.js';
export {
  CapabilityCompositionError,
  capabilitySurfaceNames,
  composeCapabilityPacks,
  createCapabilitySurfaceMap,
  defineCapabilityPack,
} from './core/composition.js';
export type {
  CapabilityAccessRule,
  CapabilityDefinition,
  CapabilityDefinitionOptions,
  CapabilityIdentity,
  CapabilityRisk,
} from './core/contracts.js';
export {
  CapabilityDefinitionError,
  canonicalCapabilityId,
  defineCapability,
  isValidCapabilityIdentity,
} from './core/contracts.js';
export type {
  DiagnosticObservation,
  DiagnosticObservationOptions,
  DiagnosticStatus,
} from './core/diagnostics.js';
export {
  createDiagnosticObservation,
  DIAGNOSTIC_OBSERVATION_JSON_SCHEMA,
} from './core/diagnostics.js';
export type {
  AuthorizationPort,
  AuthorizationRequest,
  ExecuteCapabilityRequest,
  ExecutionCaller,
  ExecutionFailure,
  ExecutionFailureKind,
  ExecutionResult,
  ExecutionSuccess,
} from './core/executor.js';
export { executeCapability } from './core/executor.js';
export type {
  BindingExecutionContext,
  CapabilityBinding,
  CapabilityBindingOptions,
  CapabilityRegistry,
  ExecutionSignal,
  RegistryErrorKind,
  RuntimeTarget,
} from './core/registry.js';
export {
  bindCapability,
  CapabilityRegistryError,
  createCapabilityRegistry,
} from './core/registry.js';
export type { SchemaPort } from './core/schema.js';
export type {
  CapabilityDiscoveryAuthorizer,
  CapabilitySurface,
  CapabilitySurfaceExposure,
  DiscoveryDecision,
  DiscoveryDenialReason,
} from './discovery.js';
export { evaluateCapabilityDiscovery, isDestructiveCapabilityExposed } from './discovery.js';
