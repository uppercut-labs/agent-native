export type DiagnosticStatus = 'passed' | 'failed' | 'unknown';

export type DiagnosticObservation = {
  readonly checkId: string;
  readonly status: DiagnosticStatus;
  readonly evidenceRefs: readonly string[];
};

export type DiagnosticObservationOptions = {
  readonly checkId: string;
  readonly status: DiagnosticStatus;
  readonly evidenceRefs?: readonly string[];
};

export const DIAGNOSTIC_OBSERVATION_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    checkId: { type: 'string', pattern: '^UAN-[0-9]{3}\\.[a-z0-9-]+$' },
    status: { type: 'string', enum: ['passed', 'failed', 'unknown'] },
    evidenceRefs: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Z][A-Z0-9._-]*$' },
    },
  },
  required: ['checkId', 'status', 'evidenceRefs'],
  additionalProperties: false,
});

export function createDiagnosticObservation(
  options: DiagnosticObservationOptions,
): DiagnosticObservation {
  if (!/^UAN-[0-9]{3}\.[a-z0-9-]+$/.test(options.checkId)) {
    throw new TypeError('checkId must use the stable UAN-NNN.check-name format');
  }

  const evidenceRefs: readonly string[] = Object.freeze([...(options.evidenceRefs ?? [])]);
  if (evidenceRefs.some((reference) => !/^[A-Z][A-Z0-9._-]*$/.test(reference))) {
    throw new TypeError('evidenceRefs must use stable opaque identifiers');
  }

  return Object.freeze({
    checkId: options.checkId,
    status: options.status,
    evidenceRefs,
  });
}
