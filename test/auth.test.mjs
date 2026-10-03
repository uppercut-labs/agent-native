import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGrantAuthorization, executionCallerForPrincipal } from '../dist/auth.js';
import {
  defineCapability,
  executeCapability,
  bindCapability,
  createCapabilityRegistry,
} from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';

const principal = {
  issuer: 'https://issuer.example',
  subject: 'user-a',
  clientId: 'fixture-client',
  tenantId: 'tenant-a',
  audience: 'https://api.example/mcp',
  scopes: ['mcp', 'playlist:edit', 'playlist:read'],
  expiresAt: 2000,
};
const query = {
  issuer: principal.issuer,
  subject: principal.subject,
  clientId: principal.clientId,
  tenantId: principal.tenantId,
  applicationId: 'playlist-demo',
  audience: principal.audience,
  policyRevision: 'v1',
};
const grant = {
  ...query,
  grantId: 'grant-a',
  scopes: ['playlist:edit'],
  issuedAt: 900,
  expiresAt: 1900,
  revokedAt: null,
};

function fixture(options = {}) {
  let calls = 0;
  const definition = defineCapability({
    identity: { namespace: 'playlist', name: 'edit', majorVersion: 1 },
    description: 'Edit a playlist.',
    input: fromZod(z.object({ tenantId: z.string(), playlistId: z.string() })),
    output: fromZod(z.object({ updated: z.boolean() })),
    risk: options.risk ?? 'write',
    access: { kind: 'protected', scopes: options.requiredScopes ?? ['playlist:edit'] },
  });
  const binding = bindCapability(definition, {
    id: 'playlist-store',
    targets: ['server'],
    execute: () => {
      calls += 1;
      return { updated: true };
    },
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  const storedGrant = {
    ...grant,
    ...(options.grantScopes === undefined ? {} : { scopes: options.grantScopes }),
    ...(options.grantExpiresAt === undefined ? {} : { expiresAt: options.grantExpiresAt }),
    ...(options.grantRevokedAt === undefined ? {} : { revokedAt: options.grantRevokedAt }),
  };
  const store = {
    async find(request) {
      return [storedGrant].filter((row) =>
        Object.entries(request).every(([key, value]) => row[key] === value),
      );
    },
    async save() {},
    async revoke() {
      return false;
    },
  };
  const authorization = createGrantAuthorization({
    principal: options.principal ?? principal,
    applicationId: query.applicationId,
    audience: options.audience ?? query.audience,
    policyRevision: query.policyRevision,
    store,
    now: () => options.now ?? 1000,
    authorizeResource: (request, trusted) =>
      request.input.tenantId === trusted.tenantId && request.input.playlistId === 'playlist-a',
  });
  return {
    calls: () => calls,
    async execute(
      caller = executionCallerForPrincipal(options.principal ?? principal),
      input = {
        tenantId: 'tenant-a',
        playlistId: 'playlist-a',
      },
    ) {
      return await executeCapability(registry, {
        identity: definition.identity,
        runtime: 'server',
        input,
        caller,
        authorization,
      });
    },
  };
}

test('public read authorization works without a grant store', async () => {
  const auth = createGrantAuthorization({
    principal: null,
    applicationId: 'public-app',
    audience: 'https://api.example/mcp',
    policyRevision: 'v1',
  });
  assert.equal(
    await auth.authorize({
      identity: { namespace: 'catalog', name: 'read', majorVersion: 1 },
      risk: 'read',
      access: { kind: 'public' },
      caller: { kind: 'anonymous' },
      input: {},
    }),
    true,
  );
});

test('valid principal and grant authorize a resource-scoped mutation', async () => {
  const run = fixture();
  assert.equal((await run.execute()).kind, 'success');
  assert.equal(run.calls(), 1);
});

test('downgraded token scopes and a mismatched execution caller deny before mutation', async () => {
  const lowScope = { ...principal, scopes: ['mcp'] };
  const first = fixture({ principal: lowScope });
  assert.equal((await first.execute()).reason, 'unauthorized');
  assert.equal(first.calls(), 0);

  const second = fixture();
  const forgedCaller = { ...executionCallerForPrincipal(principal), subject: 'other-user' };
  assert.equal((await second.execute(forgedCaller)).reason, 'unauthorized');
  assert.equal(second.calls(), 0);
});

test('protected reads require resource authorization and deny cross-tenant input before binding', async () => {
  const read = fixture({
    risk: 'read',
    requiredScopes: ['playlist:read'],
    grantScopes: ['playlist:read'],
  });
  assert.equal((await read.execute()).kind, 'success');
  assert.equal(read.calls(), 1);

  const crossTenantRead = fixture({
    risk: 'read',
    requiredScopes: ['playlist:read'],
    grantScopes: ['playlist:read'],
  });
  assert.equal(
    (
      await crossTenantRead.execute(undefined, {
        tenantId: 'tenant-b',
        playlistId: 'playlist-a',
      })
    ).reason,
    'unauthorized',
  );
  assert.equal(crossTenantRead.calls(), 0);

  const noResourcePolicy = createGrantAuthorization({
    principal,
    applicationId: query.applicationId,
    audience: query.audience,
    policyRevision: query.policyRevision,
    store: {
      async find() {
        return [{ ...grant, scopes: ['playlist:read'] }];
      },
      async save() {},
      async revoke() {
        return false;
      },
    },
    now: () => 1000,
  });
  assert.equal(
    await noResourcePolicy.authorize({
      identity: { namespace: 'playlist', name: 'read', majorVersion: 1 },
      risk: 'read',
      access: { kind: 'protected', scopes: ['playlist:read'] },
      caller: executionCallerForPrincipal(principal),
      input: { tenantId: 'tenant-a', playlistId: 'playlist-a' },
    }),
    false,
  );
});

test('expired principal, wrong audience, and cross-tenant resource are denied before mutation', async () => {
  const expired = fixture({ principal: { ...principal, expiresAt: 999 } });
  assert.equal((await expired.execute()).reason, 'unauthorized');
  assert.equal(expired.calls(), 0);

  const expiredGrant = fixture({ grantExpiresAt: 999 });
  assert.equal((await expiredGrant.execute()).reason, 'unauthorized');
  assert.equal(expiredGrant.calls(), 0);

  const revokedGrant = fixture({ grantRevokedAt: 999 });
  assert.equal((await revokedGrant.execute()).reason, 'unauthorized');
  assert.equal(revokedGrant.calls(), 0);

  const wrongAudience = fixture({ audience: 'https://other.example/mcp' });
  assert.equal((await wrongAudience.execute()).reason, 'unauthorized');
  assert.equal(wrongAudience.calls(), 0);

  const crossTenant = fixture();
  assert.equal(
    (await crossTenant.execute(undefined, { tenantId: 'tenant-b', playlistId: 'playlist-a' }))
      .reason,
    'unauthorized',
  );
  assert.equal(crossTenant.calls(), 0);
});
