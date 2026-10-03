import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

const fixtureIssuer = 'https://e07.test-issuer.invalid';
const resource = 'https://e07.test-resource.invalid/mcp';

const identities = new Map([
  [
    'alice-token',
    {
      clientId: 'e07-playlist-client',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource,
      scopes: ['mcp', 'playlist:edit', 'playlist:delete'],
      principal: { issuer: fixtureIssuer, subject: 'alice', tenantId: 'tenant-a' },
    },
  ],
  [
    'alice-low-scope-token',
    {
      clientId: 'e07-playlist-client',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource,
      scopes: ['mcp', 'playlist:read'],
      principal: { issuer: fixtureIssuer, subject: 'alice', tenantId: 'tenant-a' },
    },
  ],
  [
    'bob-token',
    {
      clientId: 'e07-playlist-client',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource,
      scopes: ['mcp', 'playlist:edit', 'playlist:delete'],
      principal: { issuer: fixtureIssuer, subject: 'bob', tenantId: 'tenant-b' },
    },
  ],
  [
    'wrong-issuer-token',
    {
      clientId: 'e07-playlist-client',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource,
      scopes: ['mcp', 'playlist:edit', 'playlist:delete'],
      principal: {
        issuer: 'https://wrong.test-issuer.invalid',
        subject: 'alice',
        tenantId: 'tenant-a',
      },
    },
  ],
  [
    'wrong-audience-token',
    {
      clientId: 'e07-playlist-client',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource: 'https://wrong.test-resource.invalid/mcp',
      scopes: ['mcp', 'playlist:edit'],
      principal: { issuer: fixtureIssuer, subject: 'alice', tenantId: 'tenant-a' },
    },
  ],
  [
    'expired-token',
    {
      clientId: 'e07-playlist-client',
      expiresAt: 1,
      resource,
      scopes: ['mcp', 'playlist:edit'],
      principal: { issuer: fixtureIssuer, subject: 'alice', tenantId: 'tenant-a' },
    },
  ],
]);

export const E07_RESOURCE = resource;
export const E07_ISSUER = fixtureIssuer;

export function createTestVerifier() {
  assertTestMode();
  return {
    async verifyAccessToken(token) {
      const identity = identities.get(token);
      if (!identity) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'invalid_token',
          'Test token is unknown.',
        );
      }
      return {
        token,
        clientId: identity.clientId,
        scopes: [...identity.scopes],
        expiresAt: identity.expiresAt,
        resource: new URL(identity.resource),
        extra: { principal: { ...identity.principal } },
      };
    },
  };
}

export function resolveTestPrincipal(authInfo) {
  const principal = authInfo.extra?.principal;
  if (
    typeof principal !== 'object' ||
    principal === null ||
    principal.issuer !== fixtureIssuer ||
    typeof principal.subject !== 'string' ||
    typeof principal.tenantId !== 'string' ||
    typeof authInfo.resource?.toString() !== 'string' ||
    authInfo.expiresAt === undefined
  ) {
    return null;
  }
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

function assertTestMode() {
  if (process.env.NODE_ENV === 'production' || process.env.UAN_E07_TEST_MODE !== '1') {
    throw new Error('E07 static test identities are available only in explicit local test mode.');
  }
}
