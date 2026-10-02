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
