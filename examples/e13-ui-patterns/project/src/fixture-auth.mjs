// Static test identities and an in-memory grant store. Local test mode only: the server
// refuses to load them otherwise, so a publicly reachable fixture is anonymous and read-only.
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { WRITE_SCOPE } from './contracts.mjs';

export const E13_ISSUER = 'https://e13.test-issuer.invalid';
export const E13_RESOURCE = 'https://e13.test-resource.invalid/mcp';
export const E13_APPLICATION = 'e13-ui-patterns';
export const E13_POLICY = 'ui-fixture-policy-v1';
const CLIENT_ID = 'e13-ui-client';

function assertTestMode() {
  if (process.env.NODE_ENV === 'production' || process.env.UAN_E13_TEST_MODE !== '1') {
    throw new Error('E13 test identities are available only in explicit local test mode.');
  }
}

const identities = new Map([
  ['editor-token', { subject: 'editor', tenantId: 'tenant-a', scopes: ['mcp', WRITE_SCOPE] }],
  ['viewer-token', { subject: 'viewer', tenantId: 'tenant-a', scopes: ['mcp'] }],
]);

export function createTestVerifier() {
  assertTestMode();
  return {
    async verifyAccessToken(token) {
      const identity = identities.get(token);
      if (identity === undefined)
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'invalid_token',
          'Test token is unknown.',
        );
      return {
        token,
        clientId: CLIENT_ID,
        scopes: [...identity.scopes],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        resource: new URL(E13_RESOURCE),
        extra: { principal: { issuer: E13_ISSUER, ...identity } },
      };
    },
  };
}

export function resolveTestPrincipal(authInfo) {
  const principal = authInfo.extra?.principal;
  if (
    typeof principal !== 'object' ||
    principal === null ||
    principal.issuer !== E13_ISSUER ||
    typeof principal.subject !== 'string' ||
    typeof principal.tenantId !== 'string' ||
    authInfo.expiresAt === undefined
  )
    return null;
  return {
    issuer: principal.issuer,
    subject: principal.subject,
    clientId: authInfo.clientId,
    tenantId: principal.tenantId,
    audience: authInfo.resource.toString(),
    scopes: [...authInfo.scopes],
    expiresAt: authInfo.expiresAt,
  };
}

/** In-memory grants; the editor holds a write grant, the viewer holds none. */
export class MemoryGrantStore {
  #grants = [];
  constructor() {
    assertTestMode();
    const now = Math.floor(Date.now() / 1000);
    this.#grants.push({
      issuer: E13_ISSUER,
      subject: 'editor',
      clientId: CLIENT_ID,
      tenantId: 'tenant-a',
      applicationId: E13_APPLICATION,
      audience: E13_RESOURCE,
      policyRevision: E13_POLICY,
      grantId: 'editor-write',
      scopes: [WRITE_SCOPE],
      issuedAt: now - 1,
      expiresAt: now + 3600,
      revokedAt: null,
    });
  }
  async find(query) {
    return this.#grants.filter((grant) =>
      Object.entries(query).every(([key, value]) => grant[key] === value),
    );
  }
  async save(grant) {
    this.#grants.push(structuredClone(grant));
  }
  async revoke(grantId, revokedAt) {
    const grant = this.#grants.find((entry) => entry.grantId === grantId);
    if (grant === undefined || grant.revokedAt !== null) return false;
    grant.revokedAt = revokedAt;
    return true;
  }
}
