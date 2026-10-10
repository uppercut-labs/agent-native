export type HarnessTarget = 'local' | 'cloud';
export type HarnessFeature = 'resume' | 'cancel' | 'usage' | 'mcp';

export type HarnessDescriptor = {
  readonly provider: string;
  readonly targets: readonly HarnessTarget[];
  readonly features: readonly HarnessFeature[];
};

export type HarnessSessionRef = {
  readonly provider: string;
  readonly sessionId: string;
  readonly target: HarnessTarget;
};

// Cloud repository/auth configuration belongs to the selected adapter's factory.
export type OpenHarnessSessionRequest =
  | { readonly target: 'local'; readonly workspace: string }
  | { readonly target: 'cloud' };

export type ResumeHarnessSessionRequest = OpenHarnessSessionRequest & {
  readonly session: HarnessSessionRef;
};

export type RunHarnessTurnRequest = {
  readonly session: HarnessSessionRef;
  readonly prompt: string;
};

export type CancelHarnessTurnRequest = {
  readonly session: HarnessSessionRef;
  readonly turnId: string;
};

export type CloseHarnessSessionRequest = { readonly session: HarnessSessionRef };

export type HarnessFailureReason =
  | 'unsupported-target'
  | 'unsupported-feature'
  | 'invalid-request'
  | 'authentication-required'
  | 'provider-unavailable'
  | 'session-not-found'
  | 'session-closed'
  | 'turn-not-found'
  | 'turn-active'
  | 'timeout'
  | 'provider-failed';

const FAILURE_MESSAGES: Readonly<Record<HarnessFailureReason, string>> = Object.freeze({
  'unsupported-target': 'The harness does not support this target.',
  'unsupported-feature': 'The harness does not support this feature.',
  'invalid-request': 'The harness request is invalid.',
  'authentication-required': 'The harness requires authentication.',
  'provider-unavailable': 'The harness provider is unavailable.',
  'session-not-found': 'The harness session was not found.',
  'session-closed': 'The harness session is closed.',
  'turn-not-found': 'The harness turn was not found.',
  'turn-active': 'The harness session already has an active turn.',
  timeout: 'The harness operation timed out.',
  'provider-failed': 'The harness provider failed.',
});

export class HarnessError extends Error {
  readonly reason: HarnessFailureReason;

  constructor(reason: HarnessFailureReason) {
    super(FAILURE_MESSAGES[reason]);
    this.name = 'HarnessError';
    this.reason = reason;
  }
}

type HarnessTurnEventRef = {
  readonly session: HarnessSessionRef;
  readonly turnId: string;
};

export type HarnessStatusEvent = HarnessTurnEventRef & {
  readonly type: 'progress' | 'tool';
  readonly message: string;
};

export type HarnessEvent =
  | { readonly type: 'session-started'; readonly session: HarnessSessionRef }
  | (HarnessTurnEventRef & { readonly type: 'turn-started' | 'completed' | 'cancelled' })
  | HarnessStatusEvent
  | (HarnessTurnEventRef & {
      readonly type: 'usage';
      readonly unit: 'tokens' | 'requests';
      readonly quantity: number;
    })
  | (HarnessTurnEventRef & { readonly type: 'failed'; readonly reason: HarnessFailureReason });

export interface ProgrammaticHarnessAdapter {
  describe(): Promise<HarnessDescriptor>;
  openSession(request: OpenHarnessSessionRequest): Promise<HarnessSessionRef>;
  resumeSession(request: ResumeHarnessSessionRequest): Promise<HarnessSessionRef>;
  runTurn(request: RunHarnessTurnRequest): AsyncIterable<HarnessEvent>;
  cancelTurn(request: CancelHarnessTurnRequest): Promise<void>;
  closeSession(request: CloseHarnessSessionRequest): Promise<void>;
}

export function assertHarnessSupport(
  descriptor: HarnessDescriptor,
  target: HarnessTarget,
  feature?: HarnessFeature,
): void {
  if (!descriptor.targets.includes(target)) throw new HarnessError('unsupported-target');
  if (feature !== undefined && !descriptor.features.includes(feature)) {
    throw new HarnessError('unsupported-feature');
  }
}

export const HARNESS_STATUS_MESSAGE_LIMIT: 240 = 240;

function checkedSession(session: HarnessSessionRef): HarnessSessionRef {
  if (
    !isBoundedText(session.provider, 64) ||
    !isBoundedText(session.sessionId, 1024) ||
    !['local', 'cloud'].includes(session.target)
  ) {
    throw new HarnessError('invalid-request');
  }
  return Object.freeze({
    provider: session.provider,
    sessionId: session.sessionId,
    target: session.target,
  });
}

function isBoundedText(value: string, limit: number): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= limit &&
    [...value].every(
      (character: string): boolean =>
        character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127,
    )
  );
}

// The adapter supplies a reviewed safe summary, never provider output or exception text.
export function createHarnessStatusEvent(event: HarnessStatusEvent): HarnessStatusEvent {
  if (
    !['progress', 'tool'].includes(event.type) ||
    !isBoundedText(event.message, HARNESS_STATUS_MESSAGE_LIMIT) ||
    !isBoundedText(event.turnId, 128)
  ) {
    throw new HarnessError('invalid-request');
  }
  return Object.freeze({
    type: event.type,
    session: checkedSession(event.session),
    turnId: event.turnId,
    message: event.message,
  });
}

// Runtime validator default for untrusted input; also proves compile-time exhaustiveness.
function invalidHarnessEvent(_event: never): never {
  throw new HarnessError('invalid-request');
}

export function createHarnessEvent(event: HarnessEvent): HarnessEvent {
  const session: HarnessSessionRef = checkedSession(event.session);
  if (event.type === 'session-started') return Object.freeze({ type: event.type, session });
  if (!isBoundedText(event.turnId, 128)) throw new HarnessError('invalid-request');
  const ref: { session: HarnessSessionRef; turnId: string } = { session, turnId: event.turnId };
  switch (event.type) {
    case 'progress':
    case 'tool':
      return createHarnessStatusEvent(event);
    case 'turn-started':
    case 'completed':
    case 'cancelled':
      return Object.freeze({ type: event.type, ...ref });
    case 'failed':
      if (!Object.hasOwn(FAILURE_MESSAGES, event.reason)) throw new HarnessError('invalid-request');
      return Object.freeze({ type: event.type, ...ref, reason: event.reason });
    case 'usage':
      if (
        !['tokens', 'requests'].includes(event.unit) ||
        !Number.isSafeInteger(event.quantity) ||
        event.quantity < 0
      ) {
        throw new HarnessError('invalid-request');
      }
      return Object.freeze({
        type: event.type,
        ...ref,
        unit: event.unit,
        quantity: event.quantity,
      });
    default:
      return invalidHarnessEvent(event);
  }
}
