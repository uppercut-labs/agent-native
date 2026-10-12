import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '../dist/mcp.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';

// Protected-only MCP servers: caller identity in bindings, required authentication,
// the operator failure hook and custom tool names.

const resource = new URL('https://mcp.example.test/mcp');
const issuer = 'https://issuer.example.test';

function protectedRegistry({ fail = false } = {}) {
  const whoami = defineCapability({
    identity: { namespace: 'example.notes', name: 'whoami', majorVersion: 1 },
    description: 'Return the record owner the binding scoped to.',
    input: fromZod(z.object({ secret: z.string().optional() })),
    output: fromZod(z.object({ owner: z.string(), tenant: z.string() })),
    risk: 'read',
    access: { kind: 'protected', scopes: ['notes:read'] },
  });
  const binding = bindCapability(whoami, {
    id: 'whoami-server',
    targets: ['server'],
    execute: (_input, context) => {
      if (fail) throw new Error('BINDING_EXCEPTION_SENTINEL');
      assert.equal(context.caller.kind, 'authenticated');
      return { owner: context.caller.identity.subject, tenant: context.caller.identity.tenantId };
    },
  });
  return createCapabilityRegistry([whoami], [binding]);
}

function protectedOptions({ bearer = {}, options = {} } = {}) {
  const now = () => Math.floor(Date.now() / 1000);
  return {
    bearerAuth: {
      verifier: {
        async verifyAccessToken(token) {
          if (token !== 'good-token') throw new Error('unknown token');
          return {
            token,
            clientId: 'client-1',
            scopes: ['notes:read'],
            expiresAt: now() + 3600,
            resource,
          };
        },
      },
      expectedResource: resource,
      ...bearer,
    },
    resolveTrustedPrincipal: (authInfo) => ({
      issuer,
      subject: 'user-7',
      clientId: authInfo.clientId,
      tenantId: 'tenant-7',
      audience: resource.toString(),
      scopes: [...authInfo.scopes],
      expiresAt: authInfo.expiresAt,
    }),
    grantAuthorization: {
      applicationId: 'notes',
      audience: resource.toString(),
      policyRevision: 'v1',
      store: {
        find: async (query) => [
          {
            ...query,
            grantId: 'grant-1',
            scopes: ['notes:read'],
            issuedAt: now() - 60,
            expiresAt: now() + 3600,
            revokedAt: null,
          },
        ],
        save: async () => {},
        revoke: async () => false,
      },
      authorizeResource: (_request, principal) => principal.subject === 'user-7',
    },
    discoverProtected: () => true,
    ...options,
  };
}

async function listen(handler) {
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (value !== undefined) headers.set(name, value);
    }
    const response = await handler(
      new Request('http://127.0.0.1' + incoming.url, {
        method: incoming.method,
        headers,
        ...(body === undefined ? {} : { body }),
      }),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    origin: 'http://127.0.0.1:' + address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function connect(origin, token) {
  const client = new Client({ name: 'protected-fixture-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
      requestInit: token === undefined ? {} : { headers: { authorization: 'Bearer ' + token } },
    }),
  );
  return client;
}

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'probe', version: '1' },
  },
});

function post(origin, headers = {}) {
  return fetch(origin + '/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: initialize,
  });
}

test('a protected binding sees the verified caller identity', async () => {
  const server = await listen(createMcpHandler(protectedRegistry(), protectedOptions()));
  const client = await connect(server.origin, 'good-token');
  try {
    const [tool] = (await client.listTools()).tools;
    const result = await client.callTool({ name: tool.name, arguments: {} });
    assert.deepEqual(result.structuredContent, { result: { owner: 'user-7', tenant: 'tenant-7' } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('a server with no public reads challenges requests without a token', async () => {
  const server = await listen(createMcpHandler(protectedRegistry(), protectedOptions()));
  try {
    const anonymous = await post(server.origin);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate') ?? '', /^Bearer/);
    assert.equal((await post(server.origin, { authorization: 'Bearer good-token' })).status, 200);
  } finally {
    await server.close();
  }
});

test('required: false keeps the anonymous handshake for a protected-only server', async () => {
  const server = await listen(
    createMcpHandler(protectedRegistry(), protectedOptions({ bearer: { required: false } })),
  );
  try {
    assert.equal((await post(server.origin)).status, 200);
  } finally {
    await server.close();
  }
});

test('the failure hook names the capability and reason without inputs or exception text', async () => {
  const failures = [];
  const handler = createMcpHandler(
    protectedRegistry({ fail: true }),
    protectedOptions({
      options: {
        onToolFailure: (failure) => {
          failures.push(failure);
          throw new Error('hook errors are ignored');
        },
      },
    }),
  );
  const server = await listen(handler);
  const client = await connect(server.origin, 'good-token');
  try {
    const [tool] = (await client.listTools()).tools;
    const result = await client.callTool({
      name: tool.name,
      arguments: { secret: 'INPUT_SENTINEL' },
    });
    assert.equal(result.isError, true);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason, 'handler-failed');
    assert.equal(failures[0].capabilityId, 'example.notes:whoami@1');
    assert.equal(failures[0].toolName, tool.name);
    assert.equal(failures[0].observation.checkId, 'UAN-002.handler-failed');
    const serialized = JSON.stringify(failures);
    assert.equal(serialized.includes('INPUT_SENTINEL'), false);
    assert.equal(serialized.includes('BINDING_EXCEPTION_SENTINEL'), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test('custom tool names are used and validated', async () => {
  const registry = protectedRegistry();
  const server = await listen(
    createMcpHandler(
      registry,
      protectedOptions({ options: { toolName: (definition) => definition.identity.name } }),
    ),
  );
  const client = await connect(server.origin, 'good-token');
  try {
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['whoami'],
    );
  } finally {
    await client.close();
    await server.close();
  }
  for (const bad of ['has space', 'x'.repeat(129), '']) {
    assert.throws(
      () => createMcpHandler(registry, protectedOptions({ options: { toolName: () => bad } })),
      /toolName/,
    );
  }
  const other = defineCapability({
    identity: { namespace: 'example.notes', name: 'other', majorVersion: 1 },
    description: 'Another tool.',
    input: fromZod(z.object({})),
    output: fromZod(z.object({ ok: z.boolean() })),
    risk: 'read',
    access: { kind: 'protected', scopes: ['notes:read'] },
  });
  const twoTools = createCapabilityRegistry(
    [...registry.definitions, other],
    [...registry.bindings],
  );
  assert.throws(
    () => createMcpHandler(twoTools, protectedOptions({ options: { toolName: () => 'same' } })),
    /unique/,
  );
});
