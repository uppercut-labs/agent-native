import { type CapabilityDefinition, canonicalCapabilityId } from './core/contracts.js';
import {
  createDiagnosticObservation,
  type DiagnosticObservation,
  type DiagnosticObservationOptions,
  type DiagnosticStatus,
} from './core/diagnostics.js';
import type { CapabilityBinding, CapabilityRegistry } from './core/registry.js';
import {
  type CapabilityDiscoveryAuthorizer,
  type CapabilitySurface,
  type CapabilitySurfaceExposure,
  evaluateCapabilityDiscovery,
  type DiscoveryDecision,
} from './discovery.js';

export type DoctorEvidenceKind = 'configured' | 'generated' | 'reachable' | 'protocol' | 'behavior';
export type DoctorEvidenceSource = 'unspecified' | 'fixture' | 'mock' | 'real-host';
export type DoctorFindingStatus = DiagnosticStatus | 'skipped';
export type DoctorFindingSeverity = 'info' | 'warning' | 'error';
export type DoctorExitCode = 0 | 1 | 2 | 3;
export const DOCTOR_REPORT_SCHEMA_VERSION = 'uan.doctor-report/v1';

const checkIdSchema = {
  type: 'string',
  pattern: '^UAN-[0-9]{3}\\.[a-z0-9-]+$',
} as const;

export const DOCTOR_REPORT_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    schemaVersion: { const: DOCTOR_REPORT_SCHEMA_VERSION },
    profile: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
        selectedCheckIds: { type: 'array', minItems: 1, uniqueItems: true, items: checkIdSchema },
        requiredCheckIds: { type: 'array', uniqueItems: true, items: checkIdSchema },
      },
      required: ['id', 'selectedCheckIds', 'requiredCheckIds'],
      additionalProperties: false,
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          checkId: checkIdSchema,
          target: { type: 'string', minLength: 1 },
          status: { enum: ['passed', 'failed', 'unknown', 'skipped'] },
          severity: { enum: ['info', 'warning', 'error'] },
          timestamp: { type: 'string', minLength: 1 },
          required: { type: 'boolean' },
          evidence: {
            type: 'object',
            properties: {
              kind: { enum: ['configured', 'generated', 'reachable', 'protocol', 'behavior'] },
              source: { enum: ['unspecified', 'fixture', 'mock', 'real-host'] },
              location: { type: 'string', minLength: 1 },
              references: {
                type: 'array',
                items: { type: 'string', pattern: '^[A-Z][A-Z0-9._-]*$' },
              },
            },
            required: ['kind', 'source', 'location', 'references'],
            additionalProperties: false,
          },
          explanation: { type: 'string', minLength: 1 },
          nextAction: { type: 'string', minLength: 1 },
        },
        required: [
          'checkId',
          'target',
          'status',
          'severity',
          'timestamp',
          'required',
          'evidence',
          'explanation',
          'nextAction',
        ],
        additionalProperties: false,
      },
    },
    exitCode: { type: 'integer', enum: [0, 1, 3] },
  },
  required: ['schemaVersion', 'profile', 'findings', 'exitCode'],
  additionalProperties: false,
});

export type DoctorEvidence = {
  readonly kind: DoctorEvidenceKind;
  readonly source: DoctorEvidenceSource;
  readonly location: string;
  readonly references: readonly string[];
};

export type DoctorFinding = {
  readonly checkId: string;
  readonly target: string;
  readonly status: DoctorFindingStatus;
  readonly severity: DoctorFindingSeverity;
  readonly timestamp: string;
  readonly required: boolean;
  readonly evidence: DoctorEvidence;
  readonly explanation: string;
  readonly nextAction: string;
};

export type DoctorCheckResult = {
  readonly status: DoctorFindingStatus;
  readonly evidenceRefs?: readonly string[];
};

export type DoctorCheck = {
  readonly checkId: string;
  readonly target: string;
  readonly required: boolean;
  readonly severity: DoctorFindingSeverity;
  readonly evidence: {
    readonly kind: DoctorEvidenceKind;
    readonly source?: DoctorEvidenceSource;
    readonly location: string;
  };
  readonly explanations: Readonly<Record<DoctorFindingStatus, string>>;
  readonly nextAction: string;
  readonly observe: () => DoctorCheckResult | Promise<DoctorCheckResult>;
};

export type DoctorReport = {
  readonly schemaVersion: typeof DOCTOR_REPORT_SCHEMA_VERSION;
  readonly profile: DoctorCheckProfile;
  readonly findings: readonly DoctorFinding[];
  readonly exitCode: Exclude<DoctorExitCode, 2>;
};

export type DoctorCheckProfile = {
  readonly id: string;
  readonly selectedCheckIds: readonly string[];
  readonly requiredCheckIds: readonly string[];
};

export type DoctorRunOptions = {
  readonly now?: () => Date;
  readonly profile?: DoctorCheckProfile;
};

export type RegistryInspection = {
  readonly definitions: readonly {
    readonly id: string;
    readonly description: string;
    readonly risk: 'read' | 'write' | 'destructive';
    readonly access:
      | { readonly kind: 'public' }
      | { readonly kind: 'protected'; readonly scopes: readonly string[] };
  }[];
  readonly bindings: readonly {
    readonly id: string;
    readonly capabilityId: string;
    readonly targets: readonly ('browser' | 'server' | 'local')[];
  }[];
};

type InspectedDefinition = RegistryInspection['definitions'][number];
type InspectedBinding = RegistryInspection['bindings'][number];

export type AuthorizedCapability = RegistryInspection['definitions'][number] & {
  readonly bindingIds: readonly string[];
};

export type AuthorizedCapabilityListOptions = {
  readonly surface: CapabilitySurface;
  readonly exposure?: CapabilitySurfaceExposure;
  readonly authorize?: CapabilityDiscoveryAuthorizer;
};

export class DoctorUsageError extends TypeError {
  public readonly exitCode = 2 as const;

  public constructor(message: string) {
    super(message);
    this.name = 'DoctorUsageError';
  }
}

function assertText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DoctorUsageError(`${field} must be non-empty`);
  }
}

function validateCheck(check: DoctorCheck): void {
  try {
    createDiagnosticObservation({ checkId: check.checkId, status: 'unknown' });
  } catch (error: unknown) {
    throw new DoctorUsageError(
      error instanceof Error ? error.message : 'doctor check id is invalid',
    );
  }
  assertText(check.target, 'target');
  if (typeof check.required !== 'boolean') throw new DoctorUsageError('required must be boolean');
  if (!['info', 'warning', 'error'].includes(check.severity)) {
    throw new DoctorUsageError('severity must be info, warning, or error');
  }
  if (
    !['configured', 'generated', 'reachable', 'protocol', 'behavior'].includes(check.evidence.kind)
  ) {
    throw new DoctorUsageError('evidence.kind is invalid');
  }
  if (
    check.evidence.source !== undefined &&
    !['unspecified', 'fixture', 'mock', 'real-host'].includes(check.evidence.source)
  ) {
    throw new DoctorUsageError('evidence.source is invalid');
  }
  assertText(check.evidence.location, 'evidence.location');
  assertText(check.nextAction, 'nextAction');
  for (const status of ['passed', 'failed', 'unknown', 'skipped'] as const) {
    assertText(check.explanations[status], `explanations.${status}`);
  }
  if (typeof check.observe !== 'function') throw new DoctorUsageError('observe must be a function');
}

function isFindingStatus(value: unknown): value is DoctorFindingStatus {
  return value === 'passed' || value === 'failed' || value === 'unknown' || value === 'skipped';
}

function freezeFinding(
  check: DoctorCheck,
  result: DoctorCheckResult,
  timestamp: string,
): DoctorFinding {
  const observedStatus: DiagnosticStatus = result.status === 'skipped' ? 'unknown' : result.status;
  const observationOptions: DiagnosticObservationOptions =
    result.evidenceRefs === undefined
      ? { checkId: check.checkId, status: observedStatus }
      : {
          checkId: check.checkId,
          status: observedStatus,
          evidenceRefs: result.evidenceRefs,
        };
  const observation: DiagnosticObservation = createDiagnosticObservation(observationOptions);
  const references: readonly string[] = observation.evidenceRefs;
  return Object.freeze({
    checkId: check.checkId,
    target: check.target,
    status: result.status,
    severity: check.severity,
    timestamp,
    required: check.required,
    evidence: Object.freeze({
      kind: check.evidence.kind,
      source: check.evidence.source ?? 'unspecified',
      location: check.evidence.location,
      references,
    }),
    explanation: check.explanations[result.status],
    nextAction: check.nextAction,
  });
}

export function doctorExitCode(findings: readonly DoctorFinding[]): Exclude<DoctorExitCode, 2> {
  if (findings.some((finding: DoctorFinding): boolean => finding.status === 'failed')) return 1;
  if (
    findings.some(
      (finding: DoctorFinding): boolean =>
        finding.required && (finding.status === 'unknown' || finding.status === 'skipped'),
    )
  ) {
    return 3;
  }
  return 0;
}

function resolveProfile(
  checks: readonly DoctorCheck[],
  profile?: DoctorCheckProfile,
): DoctorCheckProfile {
  if (
    profile !== undefined &&
    (typeof profile.id !== 'string' ||
      !Array.isArray(profile.selectedCheckIds) ||
      !Array.isArray(profile.requiredCheckIds))
  ) {
    throw new DoctorUsageError('profile must provide id, selectedCheckIds, and requiredCheckIds');
  }
  const available: ReadonlySet<string> = new Set(
    checks.map((check: DoctorCheck): string => check.checkId),
  );
  const selected: readonly string[] =
    profile?.selectedCheckIds ?? checks.map((check: DoctorCheck): string => check.checkId);
  const required: readonly string[] =
    profile?.requiredCheckIds ??
    checks
      .filter((check: DoctorCheck): boolean => check.required)
      .map((check: DoctorCheck): string => check.checkId);
  const id: string = profile?.id ?? 'default';
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new DoctorUsageError('profile id must be a lowercase slug');
  }
  if (selected.length === 0 || new Set(selected).size !== selected.length) {
    throw new DoctorUsageError('profile must select one or more distinct checks');
  }
  if (new Set(required).size !== required.length) {
    throw new DoctorUsageError('profile required checks must be distinct');
  }
  for (const checkId of selected) {
    if (!available.has(checkId)) throw new DoctorUsageError(`unknown selected check: ${checkId}`);
  }
  const selectedSet: ReadonlySet<string> = new Set(selected);
  for (const checkId of required) {
    if (!selectedSet.has(checkId)) {
      throw new DoctorUsageError(`required check is not selected: ${checkId}`);
    }
  }
  return Object.freeze({
    id,
    selectedCheckIds: Object.freeze([...selected]),
    requiredCheckIds: Object.freeze([...required]),
  });
}

export async function runDoctor(
  checks: readonly DoctorCheck[],
  options: DoctorRunOptions = {},
): Promise<DoctorReport> {
  let ids: Set<string> = new Set();
  for (const check of checks) {
    validateCheck(check);
    if (ids.has(check.checkId)) {
      throw new DoctorUsageError(`duplicate doctor check id: ${check.checkId}`);
    }
    ids.add(check.checkId);
  }
  const profile: DoctorCheckProfile = resolveProfile(checks, options.profile);
  const selected: ReadonlySet<string> = new Set(profile.selectedCheckIds);
  const required: ReadonlySet<string> = new Set(profile.requiredCheckIds);

  let findings: DoctorFinding[] = [];
  for (const check of checks) {
    if (!selected.has(check.checkId)) continue;
    let result: DoctorCheckResult;
    try {
      result = await check.observe();
      if (!isFindingStatus(result.status)) result = { status: 'unknown' };
    } catch {
      result = { status: 'unknown' };
    }
    const timestamp: string = (options.now?.() ?? new Date()).toISOString();
    findings.push(
      freezeFinding({ ...check, required: required.has(check.checkId) }, result, timestamp),
    );
  }
  const frozenFindings: readonly DoctorFinding[] = Object.freeze(findings);
  return Object.freeze({
    schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
    profile,
    findings: frozenFindings,
    exitCode: doctorExitCode(frozenFindings),
  });
}

export function inspectCapabilityRegistry(registry: CapabilityRegistry): RegistryInspection {
  const definitions: readonly InspectedDefinition[] = registry.definitions.map(
    (definition: CapabilityDefinition<unknown, unknown>): InspectedDefinition =>
      Object.freeze({
        id: canonicalCapabilityId(definition.identity),
        description: definition.description,
        risk: definition.risk,
        access:
          definition.access.kind === 'public'
            ? Object.freeze({ kind: 'public' as const })
            : Object.freeze({
                kind: 'protected' as const,
                scopes: Object.freeze([...definition.access.scopes]),
              }),
      }),
  );
  const bindings: readonly InspectedBinding[] = registry.bindings.map(
    (binding: CapabilityBinding): InspectedBinding =>
      Object.freeze({
        id: binding.id,
        capabilityId: binding.capabilityId,
        targets: Object.freeze([...binding.targets]),
      }),
  );
  return Object.freeze({
    definitions: Object.freeze(definitions),
    bindings: Object.freeze(bindings),
  });
}

export async function listAuthorizedCapabilities(
  registry: CapabilityRegistry,
  options: AuthorizedCapabilityListOptions,
): Promise<readonly AuthorizedCapability[]> {
  const inspection: RegistryInspection = inspectCapabilityRegistry(registry);
  let listed: AuthorizedCapability[] = [];
  for (const [index, definition] of registry.definitions.entries()) {
    if (definition === undefined) continue;
    const decision: DiscoveryDecision = await evaluateCapabilityDiscovery(
      definition,
      options.surface,
      options.exposure,
      options.authorize,
    );
    if (!decision.visible) continue;
    const inspected: InspectedDefinition | undefined = inspection.definitions[index];
    if (inspected === undefined) continue;
    const candidates: readonly InspectedBinding[] = inspection.bindings.filter(
      (binding: InspectedBinding): boolean => binding.capabilityId === inspected.id,
    );
    const local: readonly InspectedBinding[] = candidates.filter(
      (binding: InspectedBinding): boolean => binding.targets.includes('local'),
    );
    const server: readonly InspectedBinding[] = candidates.filter(
      (binding: InspectedBinding): boolean => binding.targets.includes('server'),
    );
    const browser: readonly InspectedBinding[] = candidates.filter(
      (binding: InspectedBinding): boolean => binding.targets.includes('browser'),
    );
    const publicRead: boolean = definition.risk === 'read' && definition.access.kind === 'public';
    const available: readonly InspectedBinding[] =
      options.surface === 'browser'
        ? browser.length === 1
          ? browser
          : []
        : options.surface === 'cli'
          ? [
              ...(local.length === 1 ? local : []),
              ...(publicRead && server.length === 1 ? server : []),
            ]
          : server.length === 1
            ? server
            : [];
    if (available.length === 0) continue;
    listed.push(
      Object.freeze({
        ...inspected,
        bindingIds: Object.freeze([
          ...new Set(available.map((binding: InspectedBinding): string => binding.id)),
        ]),
      }),
    );
  }
  return Object.freeze(listed);
}
