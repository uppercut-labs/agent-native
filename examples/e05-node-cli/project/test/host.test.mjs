import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mcpToolName } from '@uppercut-labs/agent-native/mcp';
import { albumLookup } from '../src/catalog.mjs';
import { startServer, stopServer } from '../src/server.mjs';

const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const token = 'host-fixture-secret-token';
process.env.E05_TOKEN = token;

async function withServer(run) {
  const running = await startServer({ port: 0 });
  try {
    return await run(running);
  } finally {
    await stopServer(running.server);
  }
}

function invokeHttp(origin, slug, bearer = token) {
  return fetch(`${origin}/agent-native/v1/capabilities/example.catalog/album.lookup/v1/invoke`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ slug }),
  });
}

function collectChild(args, env) {
  const child = spawn(process.execPath, [serverPath, ...args], {
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, exited, stderr: () => stderr };
}

async function waitForListening(run) {
  // 5 s covers a cold Node start on a loaded machine; callers always kill the child on failure.
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const match = run.stderr().match(/listening=(http:\/\/127\.0\.0\.1:\d+)/);
    if (match) return match[1];
    if (run.child.exitCode !== null) throw new Error('server exited before listening');
    await delay(10);
  }
  throw new Error('server did not listen in time');
}

test('one Hono host returns matching HTTP and official MCP client results', async () => {
  await withServer(async ({ origin }) => {
    const httpResponse = await invokeHttp(origin, 'first-light');
    assert.equal(httpResponse.status, 200);
    const httpValue = await httpResponse.json();

    const client = new Client({ name: 'e05-hono-fixture', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    try {
      await client.connect(transport);
      const toolName = mcpToolName(albumLookup.identity);
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        [toolName],
      );
      const mcpResult = await client.callTool({
        name: toolName,
        arguments: { slug: 'first-light' },
      });
      assert.equal(mcpResult.isError, undefined);
      assert.deepEqual(mcpResult.structuredContent.result, httpValue);
    } finally {
      await client.close();
    }
  });
});

test('host rejects unauthorized HTTP and malformed MCP without exposing credentials', async () => {
  await withServer(async ({ origin }) => {
    const denied = await invokeHttp(origin, 'first-light', `wrong-${token}`);
    assert.equal(denied.status, 404);
    assert.equal((await denied.text()).includes(token), false);

    const malformed = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: '{bad',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes(token), false);
  });
});

test('bounded request and host shutdown settle without an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const running = await startServer({ port: 0 });
  try {
    const request = invokeHttp(running.origin, 'bounded-wait');
    await delay(20);
    const shutdown = stopServer(running.server);
    const response = await request;
    assert.equal(response.status, 504);
    await shutdown;
    await delay(20);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await stopServer(running.server);
  }
});

test('server handles SIGTERM and reports port conflict without stacks or secrets', async () => {
  const signalRun = collectChild([], { ...process.env, PORT: '0', E05_TOKEN: token });
  let signaled;
  try {
    await waitForListening(signalRun);
    signalRun.child.kill('SIGTERM');
    signaled = await signalRun.exited;
  } finally {
    // Never leave an orphaned server holding the test runner open.
    if (signalRun.child.exitCode === null && signalRun.child.signalCode === null) {
      signalRun.child.kill('SIGKILL');
    }
  }
  assert.equal(signaled.code, 0);
  assert.equal(signaled.signal, null);
  assert.equal(signaled.stdout, '');
  assert.match(signaled.stderr, /shutdown=SIGTERM/);
  assert.equal(signaled.stderr.includes(token), false);

  await withServer(async ({ origin }) => {
    const occupiedPort = new URL(origin).port;
    const conflictRun = collectChild([], {
      ...process.env,
      PORT: occupiedPort,
      E05_TOKEN: token,
    });
    const guard = setTimeout(() => conflictRun.child.kill('SIGKILL'), 10_000);
    const conflict = await conflictRun.exited;
    clearTimeout(guard);
    assert.equal(conflict.code, 1);
    assert.equal(conflict.stdout, '');
    assert.equal(conflict.stderr, 'server_error=address-in-use\n');
    assert.equal(conflict.stderr.includes(token), false);
    assert.equal(conflict.stderr.includes(' at '), false);
  });
});
