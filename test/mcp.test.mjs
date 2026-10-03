import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { canonicalCapabilityId } from '../dist/core/contracts.js';
import { createMcpAppsHandler, validateMcpAppResources } from '../dist/mcp-apps.js';
import { createMcpHandler, mcpToolName } from '../dist/mcp.js';
import { createDiagnosticObservation } from '../dist/core/diagnostics.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';

const lookupIdentity = { namespace: 'example.catalog', name: 'album.lookup', majorVersion: 1 };
const lookupInput = fromZod(z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }));
const lookupOutput = fromZod(
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('found'),
      album: z.object({ slug: z.string(), title: z.string() }),
    }),
    z.object({ kind: z.literal('missing') }),
  ]),
);

function createFixtureRegistry() {
  let publicCalls = 0;
  let hiddenCalls = 0;
  const lookup = defineCapability({
    identity: lookupIdentity,
    description: 'Look up a public sample album by slug.',
    input: lookupInput,
    output: lookupOutput,
    risk: 'read',
    access: { kind: 'public' },
  });
  const hidden = defineCapability({
    identity: { namespace: 'account', name: 'delete', majorVersion: 1 },
    description: 'PRIVATE_TOOL_SENTINEL',
    input: fromZod(z.object({ accountId: z.string() })),
    output: fromZod(z.object({ deleted: z.boolean() })),
    risk: 'destructive',
    access: { kind: 'protected', scopes: ['account:delete'] },
  });
  const unbound = defineCapability({
    identity: { namespace: 'example.catalog', name: 'unbound', majorVersion: 1 },
    description: 'NO_SERVER_BINDING_SENTINEL',
    input: fromZod(z.object({})),
    output: fromZod(z.object({ ok: z.boolean() })),
    risk: 'read',
    access: { kind: 'public' },
  });
  const lookupBinding = bindCapability(lookup, {
    id: 'public-catalog',
    targets: ['server'],
    execute: async ({ slug }) => {
      publicCalls += 1;
      return slug === 'first-light'
        ? { kind: 'found', album: { slug, title: 'First Light' } }
        : { kind: 'missing' };
    },
  });
  const hiddenBinding = bindCapability(hidden, {
    id: 'private-account',
    targets: ['server'],
    execute: async () => {
      hiddenCalls += 1;
      return { deleted: true };
    },
  });
  return {
    registry: createCapabilityRegistry([lookup, hidden, unbound], [lookupBinding, hiddenBinding]),
    counts: () => ({ publicCalls, hiddenCalls }),
    hidden,
  };
}

async function listen(handler) {
  let requests = 0;
  const server = createServer(async (incoming, outgoing) => {
    requests += 1;
    const chunks = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request('http://127.0.0.1' + incoming.url, {
      method: incoming.method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    origin: 'http://127.0.0.1:' + address.port,
    requests: () => requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function jsonRpcPost(origin, body) {
  return fetch(origin + '/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body,
  });
}

test('official SDK client discovers and calls a public capability over real HTTP', async () => {
  const fixture = createFixtureRegistry();
  const handler = createMcpHandler(fixture.registry);
  const server = await listen(handler);
  const client = new Client({ name: 'uan-005-fixture-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));

  try {
    await client.connect(transport);
    assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
    const discovery = await client.listTools();
    const tool = mcpToolName(lookupIdentity);
    assert.deepEqual(
      discovery.tools.map((candidate) => candidate.name),
      [tool],
    );
    assert.equal(discovery.tools[0].inputSchema.properties.slug.type, 'string');
    assert.equal(discovery.tools[0].annotations.readOnlyHint, true);
    assert.equal(JSON.stringify(discovery).includes('PRIVATE_TOOL_SENTINEL'), false);
    assert.equal(JSON.stringify(discovery).includes('NO_SERVER_BINDING_SENTINEL'), false);

    const result = await client.callTool({
      name: tool,
      arguments: { slug: 'first-light' },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      result: { kind: 'found', album: { slug: 'first-light', title: 'First Light' } },
    });
    assert.deepEqual(lookupOutput.parse(result.structuredContent.result), {
      kind: 'found',
      album: { slug: 'first-light', title: 'First Light' },
    });

    const observation = createDiagnosticObservation({
      checkId: 'UAN-005.mcp-protocol',
      status: 'passed',
      evidenceRefs: ['E-UAN-005-01'],
    });
    assert.deepEqual(observation, {
      checkId: 'UAN-005.mcp-protocol',
      status: 'passed',
      evidenceRefs: ['E-UAN-005-01'],
    });
    assert.ok(server.requests() >= 3);
  } finally {
    await client.close();
    await server.close();
  }
});

test('official SDK endpoint bounds malformed, oversized, invalid and hidden requests', async () => {
  const fixture = createFixtureRegistry();
  const handler = createMcpHandler(fixture.registry, { maxRequestBytes: 1024 });
  const server = await listen(handler);
  const tool = mcpToolName(lookupIdentity);
  const hiddenTool = mcpToolName(fixture.hidden.identity);

  try {
    const wrongShape = await jsonRpcPost(server.origin, JSON.stringify({ wrong: 'shape' }));
    assert.equal(wrongShape.status, 400);
    const oversized = await jsonRpcPost(server.origin, JSON.stringify({ wrong: 'x'.repeat(2048) }));
    assert.equal(oversized.status, 413);

    const client = new Client({ name: 'uan-005-negative-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));
    try {
      await client.connect(transport);
      let before = server.requests();
      const invalid = await client.callTool({
        name: tool,
        arguments: { slug: 'not valid' },
      });
      assert.ok(server.requests() > before);
      assert.equal(invalid.isError, true);
      assert.equal(JSON.stringify(invalid).includes('not valid'), false);

      before = server.requests();
      await assert.rejects(
        client.callTool({
          name: hiddenTool,
          arguments: { accountId: 'fixture' },
        }),
        /not found/i,
      );
      assert.ok(server.requests() > before);
    } finally {
      await client.close();
    }
    assert.deepEqual(fixture.counts(), { publicCalls: 0, hiddenCalls: 0 });
  } finally {
    await server.close();
  }
});

test('configured discovery policy hides a public tool and its direct name call', async () => {
  const fixture = createFixtureRegistry();
  const handler = createMcpHandler(fixture.registry, {
    canDiscover: (definition) => definition.identity.name !== 'album.lookup',
  });
  const server = await listen(handler);
  const client = new Client({ name: 'uan-005-hidden-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));

  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools, []);
    const before = server.requests();
    await assert.rejects(
      client.callTool({
        name: mcpToolName(lookupIdentity),
        arguments: { slug: 'first-light' },
      }),
    );
    assert.ok(server.requests() > before);
    assert.deepEqual(fixture.counts(), { publicCalls: 0, hiddenCalls: 0 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('protected discovery and grant authorization cannot be partially or ambiguously configured', () => {
  const fixture = createFixtureRegistry();
  assert.throws(
    () => createMcpHandler(fixture.registry, { discoverProtected: () => true }),
    /protected discovery requires verified principals and grant authorization/,
  );

  const trustedOptions = {
    bearerAuth: {
      verifier: {
        verifyAccessToken: async () => {
          throw new Error('unused');
        },
      },
      expectedResource: new URL('https://mcp.example.test/resource'),
    },
    resolveTrustedPrincipal: () => null,
    grantAuthorization: {
      applicationId: 'fixture',
      audience: 'https://mcp.example.test/resource',
      policyRevision: 'v1',
      store: { find: async () => [], save: async () => {}, revoke: async () => false },
    },
  };
  assert.throws(
    () =>
      createMcpHandler(fixture.registry, {
        ...trustedOptions,
        resolveExecutionContext: () => ({
          caller: { kind: 'anonymous' },
          authorization: { authorize: () => true },
        }),
      }),
    /custom execution context cannot be combined with grant authorization/,
  );
});

test('legacy canDiscover callback cannot opt protected definitions into discovery', async () => {
  const fixture = createFixtureRegistry();
  const handler = createMcpHandler(fixture.registry, { canDiscover: () => true });
  const server = await listen(handler);
  const client = new Client({ name: 'uan-010-legacy-discovery-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));

  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, mcpToolName(lookupIdentity));
    assert.equal(JSON.stringify(tools).includes('PRIVATE_TOOL_SENTINEL'), false);
    await assert.rejects(
      client.callTool({
        name: mcpToolName(fixture.hidden.identity),
        arguments: { accountId: 'account-a' },
      }),
    );
    assert.deepEqual(fixture.counts(), { publicCalls: 0, hiddenCalls: 0 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('permissive protected discovery cannot bypass current token scopes or durable grants', async () => {
  const fixture = createFixtureRegistry();
  const resource = new URL('https://mcp.example.test/resource');
  const handler = createMcpHandler(fixture.registry, {
    bearerAuth: {
      verifier: {
        async verifyAccessToken(token) {
          return {
            token,
            clientId: 'mcp-fixture-client',
            scopes: ['mcp'],
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            resource,
          };
        },
      },
      expectedResource: resource,
    },
    resolveTrustedPrincipal(authInfo) {
      return {
        issuer: 'https://issuer.example.test',
        subject: 'caller-a',
        clientId: authInfo.clientId,
        tenantId: 'tenant-a',
        audience: resource.toString(),
        scopes: [...authInfo.scopes],
        expiresAt: authInfo.expiresAt,
      };
    },
    grantAuthorization: {
      applicationId: 'mcp-discovery-test',
      audience: resource.toString(),
      policyRevision: 'v1',
      store: { find: async () => [], save: async () => {}, revoke: async () => false },
    },
    discoverProtected: () => true,
  });
  const server = await listen(handler);
  const client = new Client({ name: 'uan-011-no-grant-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'), {
    requestInit: { headers: { authorization: 'Bearer fixture-token' } },
  });

  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [mcpToolName(lookupIdentity)],
    );
    assert.equal(JSON.stringify(tools).includes('PRIVATE_TOOL_SENTINEL'), false);
    await assert.rejects(
      client.callTool({
        name: mcpToolName(fixture.hidden.identity),
        arguments: { accountId: 'account-a' },
      }),
    );
    assert.deepEqual(fixture.counts(), { publicCalls: 0, hiddenCalls: 0 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP stale destructive calls recheck the live surface exposure before the binding', async () => {
  const fixture = createFixtureRegistry();
  const resource = new URL('https://mcp.example.test/resource');
  const exposure = { mcp: { destructive: ['account:delete@1'] } };
  const handler = createMcpHandler(fixture.registry, {
    surfaceExposure: exposure,
    bearerAuth: {
      verifier: {
        async verifyAccessToken(token) {
          return {
            token,
            clientId: 'mcp-fixture-client',
            scopes: ['mcp', 'account:delete'],
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            resource,
          };
        },
      },
      expectedResource: resource,
    },
    resolveTrustedPrincipal(authInfo) {
      return {
        issuer: 'https://issuer.example.test',
        subject: 'caller-a',
        clientId: authInfo.clientId,
        tenantId: 'tenant-a',
        audience: resource.toString(),
        scopes: [...authInfo.scopes],
        expiresAt: authInfo.expiresAt,
      };
    },
    grantAuthorization: {
      applicationId: 'mcp-discovery-test',
      audience: resource.toString(),
      policyRevision: 'v1',
      store: {
        async find() {
          return [
            {
              issuer: 'https://issuer.example.test',
              subject: 'caller-a',
              clientId: 'mcp-fixture-client',
              tenantId: 'tenant-a',
              applicationId: 'mcp-discovery-test',
              audience: resource.toString(),
              policyRevision: 'v1',
              grantId: 'delete-grant',
              scopes: ['account:delete'],
              issuedAt: Math.floor(Date.now() / 1000) - 1,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              revokedAt: null,
            },
          ];
        },
        async save() {},
        async revoke() {
          return false;
        },
      },
    },
    discoverProtected: () => true,
  });
  const server = await listen(handler);
  const client = new Client({ name: 'uan-011-stale-destructive-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'), {
    requestInit: { headers: { authorization: 'Bearer fixture-token' } },
  });

  try {
    await client.connect(transport);
    assert.ok(
      (await client.listTools()).tools.some(
        (tool) => tool.name === mcpToolName(fixture.hidden.identity),
      ),
    );
    exposure.mcp.destructive.length = 0;
    await assert.rejects(
      client.callTool({
        name: mcpToolName(fixture.hidden.identity),
        arguments: { accountId: 'account-a' },
      }),
    );
    assert.equal(fixture.counts().hiddenCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP App resources reject origin and URI tricks before registration', () => {
  const fixture = createFixtureRegistry();
  const capabilityId = canonicalCapabilityId(lookupIdentity);
  const invalidResources = [
    {
      capabilityId,
      uri: 'https://attacker.example/app.html',
      name: 'external scheme',
      html: '<main>fixture</main>',
    },
    {
      capabilityId,
      uri: 'ui://uppercut/../app.html',
      name: 'traversal',
      html: '<main>fixture</main>',
    },
    {
      capabilityId,
      uri: 'ui://uppercut/app.html',
      name: 'external script',
      html: '<script src="//attacker.example/app.js"></script>',
    },
    {
      capabilityId,
      uri: 'ui://uppercut/app.html',
      name: 'external CSS',
      html: '<style>@import url(https://attacker.example/app.css)</style>',
    },
  ];

  for (const resource of invalidResources) {
    assert.throws(() => validateMcpAppResources(fixture.registry, [resource]), TypeError);
  }
  assert.throws(
    () =>
      validateMcpAppResources(fixture.registry, [
        {
          ...invalidResources[2],
          capabilityId: 'missing.capability:read@1',
          html: '<main>fixture</main>',
        },
      ]),
    /undeclared capability/,
  );
});

test('MCP App resource access is recalculated after revocation in the same client session', async () => {
  const fixture = createFixtureRegistry();
  const resourceAudience = new URL('https://mcp-app.example.test/resource');
  const publicUri = 'ui://uppercut/public-album.html';
  const protectedUri = 'ui://uppercut/protected-account.html';
  const now = Math.floor(Date.now() / 1000);
  const grant = {
    issuer: 'https://issuer.example.test',
    subject: 'caller-a',
    clientId: 'mcp-app-fixture-client',
    tenantId: 'tenant-a',
    applicationId: 'mcp-app-resource-test',
    audience: resourceAudience.toString(),
    policyRevision: 'v1',
    grantId: 'protected-resource-grant',
    scopes: ['account:delete'],
    issuedAt: now - 1,
    expiresAt: now + 3600,
    revokedAt: null,
  };
  const handler = createMcpAppsHandler(fixture.registry, {
    resources: [
      {
        capabilityId: canonicalCapabilityId(lookupIdentity),
        uri: publicUri,
        name: 'Public album',
        html: '<main>Public fixture</main>',
      },
      {
        capabilityId: canonicalCapabilityId(fixture.hidden.identity),
        uri: protectedUri,
        name: 'Protected account',
        html: '<main>Protected fixture</main>',
      },
    ],
    surfaceExposure: { mcp: { destructive: ['account:delete@1'] } },
    bearerAuth: {
      verifier: {
        async verifyAccessToken(token) {
          return {
            token,
            clientId: grant.clientId,
            scopes: ['mcp', 'account:delete'],
            expiresAt: now + 3600,
            resource: resourceAudience,
          };
        },
      },
      expectedResource: resourceAudience,
    },
    resolveTrustedPrincipal(authInfo) {
      return {
        issuer: grant.issuer,
        subject: grant.subject,
        clientId: authInfo.clientId,
        tenantId: grant.tenantId,
        audience: resourceAudience.toString(),
        scopes: [...authInfo.scopes],
        expiresAt: authInfo.expiresAt,
      };
    },
    grantAuthorization: {
      applicationId: grant.applicationId,
      audience: grant.audience,
      policyRevision: grant.policyRevision,
      store: {
        async find() {
          return [structuredClone(grant)];
        },
        async save() {},
        async revoke() {
          return false;
        },
      },
      authorizeResource: () => true,
    },
    discoverProtected: () => true,
  });
  const server = await listen(handler);
  const anonymous = new Client({ name: 'uan-020-anonymous-app-client', version: '1.0.0' });
  const authenticated = new Client({ name: 'uan-020-authenticated-app-client', version: '1.0.0' });

  try {
    await anonymous.connect(new StreamableHTTPClientTransport(new URL(server.origin + '/mcp')));
    assert.deepEqual(
      (await anonymous.listResources()).resources.map((resource) => resource.uri),
      [publicUri],
    );
    await assert.rejects(anonymous.readResource({ uri: protectedUri }));

    await authenticated.connect(
      new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'), {
        requestInit: { headers: { authorization: 'Bearer fixture-resource-token' } },
      }),
    );
    assert.deepEqual(
      (await authenticated.listResources()).resources.map((resource) => resource.uri).sort(),
      [protectedUri, publicUri].sort(),
    );
    const resource = await authenticated.readResource({ uri: protectedUri });
    assert.deepEqual(resource.contents, [
      {
        uri: protectedUri,
        mimeType: 'text/html;profile=mcp-app',
        text: '<main>Protected fixture</main>',
      },
    ]);

    grant.revokedAt = now;
    assert.deepEqual(
      (await authenticated.listResources()).resources.map((resource) => resource.uri),
      [publicUri],
    );
    await assert.rejects(authenticated.readResource({ uri: protectedUri }));
    assert.deepEqual(fixture.counts(), { publicCalls: 0, hiddenCalls: 0 });
  } finally {
    await anonymous.close().catch(() => {});
    await authenticated.close().catch(() => {});
    await server.close();
  }
});

test('per-request authorization is enforced by the shared executor', async () => {
  const fixture = createFixtureRegistry();
  const handler = createMcpHandler(fixture.registry, {
    resolveExecutionContext: () => ({
      caller: { kind: 'anonymous' },
      authorization: { authorize: () => false },
    }),
  });
  const server = await listen(handler);
  const client = new Client({ name: 'uan-005-auth-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));

  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 1);
    const denied = await client.callTool({
      name: mcpToolName(lookupIdentity),
      arguments: { slug: 'first-light' },
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /not found/i);
    assert.deepEqual(fixture.counts(), { publicCalls: 0, hiddenCalls: 0 });
  } finally {
    await client.close();
    await server.close();
  }
});

test('non-JSON top-level results fail with a redacted tool error', async () => {
  const input = fromZod(z.object({}));
  const output = fromZod(z.any());
  const definitions = [
    defineCapability({
      identity: { namespace: 'example.serialization', name: 'undefined', majorVersion: 1 },
      description: 'Return a deliberately non-JSON value.',
      input,
      output,
      risk: 'read',
      access: { kind: 'public' },
    }),
    defineCapability({
      identity: { namespace: 'example.serialization', name: 'bigint', majorVersion: 1 },
      description: 'Return a deliberately non-JSON value.',
      input,
      output,
      risk: 'read',
      access: { kind: 'public' },
    }),
  ];
  const bindings = [
    bindCapability(definitions[0], {
      id: 'undefined-result',
      targets: ['server'],
      execute: async () => undefined,
    }),
    bindCapability(definitions[1], {
      id: 'bigint-result',
      targets: ['server'],
      execute: async () => 1n,
    }),
  ];
  const registry = createCapabilityRegistry(definitions, bindings);
  const server = await listen(createMcpHandler(registry));
  const client = new Client({ name: 'uan-005-serialization-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));

  try {
    await client.connect(transport);
    for (const identity of definitions.map((definition) => definition.identity)) {
      const result = await client.callTool({ name: mcpToolName(identity), arguments: {} });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /could not be serialized/i);
      assert.equal(JSON.stringify(result).includes('undefined'), false);
      assert.equal(JSON.stringify(result).includes('BigInt'), false);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('tool naming is collision-free for separator-bearing identities', () => {
  assert.notEqual(
    mcpToolName({ namespace: 'catalog.album', name: 'lookup', majorVersion: 1 }),
    mcpToolName({ namespace: 'catalog', name: 'album.lookup', majorVersion: 1 }),
  );
});

test('non-MCP paths and invalid adapter options fail closed', async () => {
  const fixture = createFixtureRegistry();
  const handler = createMcpHandler(fixture.registry);
  const response = await handler(new Request('http://localhost/not-mcp'));
  assert.equal(response.status, 404);
  assert.throws(() => createMcpHandler(fixture.registry, { endpoint: '/../mcp' }), TypeError);
  assert.throws(() => createMcpHandler(fixture.registry, { maxRequestBytes: 0 }), RangeError);
  assert.throws(() => createMcpHandler(fixture.registry, { deadlineMs: 300_001 }), RangeError);
});

test('timed-out protected MCP write reports uncertain completion and is never retried', async () => {
  const identity = { namespace: 'mcp.test', name: 'write-once', majorVersion: 1 };
  const definition = defineCapability({
    identity,
    description: 'Delayed write fixture.',
    input: fromZod(z.object({ value: z.string() })),
    output: fromZod(z.object({ saved: z.boolean() })),
    risk: 'write',
    access: { kind: 'protected', scopes: ['fixture:write'] },
  });
  let calls = 0;
  let committed = 0;
  let sawAbort = false;
  const binding = bindCapability(definition, {
    id: 'delayed-write',
    targets: ['server'],
    execute: async (_input, context) => {
      calls += 1;
      context.signal?.addEventListener('abort', () => {
        sawAbort = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      committed += 1;
      return { saved: true };
    },
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  const resource = new URL('https://mcp.example.test/write');
  const now = Math.floor(Date.now() / 1000);
  const handler = createMcpHandler(registry, {
    deadlineMs: 20,
    bearerAuth: {
      verifier: {
        async verifyAccessToken(token) {
          return {
            token,
            clientId: 'timeout-client',
            scopes: ['mcp', 'fixture:write'],
            expiresAt: now + 3600,
            resource,
          };
        },
      },
      expectedResource: resource,
    },
    resolveTrustedPrincipal(authInfo) {
      return {
        issuer: 'https://issuer.example.test',
        subject: 'caller-a',
        clientId: authInfo.clientId,
        tenantId: 'tenant-a',
        audience: resource.toString(),
        scopes: [...authInfo.scopes],
        expiresAt: authInfo.expiresAt,
      };
    },
    grantAuthorization: {
      applicationId: 'timeout-test',
      audience: resource.toString(),
      policyRevision: 'v1',
      store: {
        async find() {
          return [
            {
              issuer: 'https://issuer.example.test',
              subject: 'caller-a',
              clientId: 'timeout-client',
              tenantId: 'tenant-a',
              applicationId: 'timeout-test',
              audience: resource.toString(),
              policyRevision: 'v1',
              grantId: 'write-grant',
              scopes: ['fixture:write'],
              issuedAt: now - 1,
              expiresAt: now + 3600,
              revokedAt: null,
            },
          ];
        },
        async save() {},
        async revoke() {
          return false;
        },
      },
      authorizeResource: () => true,
    },
    discoverProtected: () => true,
  });
  const server = await listen(handler);
  const client = new Client({ name: 'uan-020-timeout-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`), {
    requestInit: { headers: { authorization: 'Bearer fixture-token' } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: mcpToolName(identity),
      arguments: { value: 'only-once' },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /write may have completed.*Do not retry/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 1);
    assert.equal(committed, 1);
    assert.equal(sawAbort, true);
  } finally {
    await client.close();
    await server.close();
  }
});
