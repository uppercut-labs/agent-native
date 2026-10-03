import 'server-only';

const fixtureSessions = new Map([
  ['fixture-session-alex', 'reader-alex'],
  ['fixture-session-mina', 'reader-mina'],
]);

const issuedIdentities = new WeakSet();

export class FixtureSessionError extends Error {
  constructor() {
    super('Unknown fixture session');
    this.name = 'FixtureSessionError';
  }
}

export function issueFixtureIdentity(sessionToken) {
  const userId = fixtureSessions.get(sessionToken);
  if (!userId) {
    throw new FixtureSessionError();
  }

  const identity = Object.freeze({ userId });
  issuedIdentities.add(identity);
  return identity;
}

export function assertFixtureIdentity(identity) {
  if (!identity || !issuedIdentities.has(identity)) {
    throw new TypeError('Identity was not issued by the fixture identity boundary');
  }
}
