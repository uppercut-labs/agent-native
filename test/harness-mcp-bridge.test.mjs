import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHarnessMcpBridge } from '@uppercut-labs/agent-native/harness/mcp-bridge';
import { createMcpHandler, mcpToolName } from '../dist/mcp.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';

test('loopback bridge rejects public binds and preserves auth, paths and unrelated listeners', async () => {
  for (const host of ['0.0.0.0', '::', 'localhost', 'example.test']) {
    await assert.rejects(
      startHarnessMcpBridge({ host, handler: async () => new Response() }),
      TypeError,
    );
  }
  let calls = 0;
  const bridge = await startHarnessMcpBridge({
    handler: async (request) => {
      calls++;
      assert.equal(request.headers.get('authorization'), 'Bearer synthetic');
      assert.equal(await request.text(), 'body');
      return new Response('denied', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
    },
  });
  const unrelated = await startHarnessMcpBridge({ handler: async () => new Response('unrelated') });
  try {
    assert.equal(new URL(bridge.url).hostname, '127.0.0.1');
    const result = await fetch(bridge.url, {
      method: 'POST',
      body: 'body',
      headers: { authorization: 'Bearer synthetic' },
    });
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('www-authenticate'), 'Bearer');
    assert.equal(await result.text(), 'denied');
    assert.equal(
      (await fetch(bridge.url, { headers: { origin: 'https://other.example' } })).status,
      403,
    );
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const probe = request(bridge.url, { headers: { host: 'other.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      probe.on('error', reject);
      probe.end();
    });
    assert.equal(forgedHostStatus, 421);
    assert.equal((await fetch(bridge.url.replace('/mcp', '/other'))).status, 404);
    assert.equal(calls, 1);
    await Promise.all([bridge.close(), bridge.close()]);
    await assert.rejects(fetch(bridge.url));
    assert.equal(await (await fetch(unrelated.url)).text(), 'unrelated');
  } finally {
    await bridge.close();
    await unrelated.close();
  }
});

test('bridge bounds request bodies and aborts timed out requests', async () => {
  let called = 0;
  let aborted = false;
  const bridge = await startHarnessMcpBridge({
    maxRequestBytes: 4,
    deadlineMs: 50,
    handler: (request) => {
      called++;
      return new Promise((resolve) =>
        request.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve(new Response('late'));
          },
          { once: true },
        ),
      );
    },
  });
  try {
    assert.equal((await fetch(bridge.url, { method: 'POST', body: 'oversized' })).status, 413);
    assert.equal(called, 0);
    assert.equal((await fetch(bridge.url)).status, 504);
    assert.equal(aborted, true);
  } finally {
    await bridge.close();
  }
});

test('bridge closes active SSE without waiting for the request deadline', async () => {
  let cancelled = false;
  const bridge = await startHarnessMcpBridge({
    handler: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ready\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  const response = await fetch(bridge.url);
  const reader = response.body.getReader();
  await reader.read();
  await bridge.close();
  assert.equal(cancelled, true);
  await assert.rejects(reader.read());
});

test('real MCP client cannot invoke a protected binding through the bridge without grants', async () => {
  let executed = 0;
  const capability = defineCapability({
    identity: { namespace: 'bridge.fixture', name: 'protected', majorVersion: 1 },
    description: 'Synthetic protected operation.',
    risk: 'read',
    input: fromZod(z.object({})),
    output: fromZod(z.object({ ok: z.boolean() })),
    access: { kind: 'protected', scopes: ['fixture:read'] },
  });
  const registry = createCapabilityRegistry(
    [capability],
    [
      bindCapability(capability, {
        id: 'fixture',
        targets: ['server'],
        execute: async () => {
          executed++;
          return { ok: true };
        },
      }),
    ],
  );
  const resource = new URL('https://mcp.example.test/resource');
  const bridge = await startHarnessMcpBridge({
    handler: createMcpHandler(registry, {
      bearerAuth: {
        expectedResource: resource,
        verifier: {
          async verifyAccessToken(token) {
            return {
              token,
              clientId: 'fixture',
              scopes: ['mcp', 'fixture:read'],
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              resource,
            };
          },
        },
      },
      resolveTrustedPrincipal: (info) => ({
        issuer: 'https://issuer.example.test',
        subject: 'fixture',
        clientId: info.clientId,
        tenantId: 'fixture',
        audience: resource.toString(),
        scopes: info.scopes,
        expiresAt: info.expiresAt,
      }),
      grantAuthorization: {
        applicationId: 'fixture',
        audience: resource.toString(),
        policyRevision: 'v1',
        store: { find: async () => [], save: async () => {}, revoke: async () => false },
      },
      discoverProtected: () => true,
    }),
  });
  const client = new Client({ name: 'bridge-fixture', version: '1.0.0' });
  try {
    assert.equal(
      (
        await fetch(bridge.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'fixture', version: '1.0.0' },
            },
          }),
        })
      ).status,
      200,
    );
    const anonymous = new Client({ name: 'anonymous-bridge-fixture', version: '1.0.0' });
    try {
      await anonymous.connect(new StreamableHTTPClientTransport(new URL(bridge.url)));
      assert.deepEqual((await anonymous.listTools()).tools, []);
      await assert.rejects(
        anonymous.callTool({ name: mcpToolName(capability.identity), arguments: {} }),
      );
    } finally {
      await anonymous.close();
    }
    await client.connect(
      new StreamableHTTPClientTransport(new URL(bridge.url), {
        requestInit: { headers: { authorization: 'Bearer synthetic' } },
      }),
    );
    assert.deepEqual((await client.listTools()).tools, []);
    await assert.rejects(
      client.callTool({ name: mcpToolName(capability.identity), arguments: {} }),
    );
    assert.equal(executed, 0);
  } finally {
    await client.close();
    await bridge.close();
  }
});
