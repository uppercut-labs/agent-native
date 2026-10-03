import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['./dist/server/entry.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

try {
  for (const path of ['index.html', 'albums/index.html', 'about/index.html']) {
    assert.match(
      await readFile(new URL(`../dist/client/${path}`, import.meta.url), 'utf8'),
      /Needle/,
    );
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${origin}/`)).ok) break;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (attempt === 49) throw new Error('Astro server did not become ready.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const path of ['/', '/albums/', '/about/']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
  }

  const staticPost = await fetch(`${origin}/protocol-post-negative.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize' }),
  });
  const staticBody = await staticPost.json();
  assert.equal(staticPost.status, 200);
  assert.equal(staticBody.kind, 'static-negative-case');
  assert.equal('jsonrpc' in staticBody, false);
  assert.equal('result' in staticBody, false);

  const invocation = '/agent-native/v1/capabilities/example.catalog/album.lookup/v1/invoke';
  const invoke = (slug, authorization = 'Bearer e02-local-fixture') =>
    fetch(`${origin}${invocation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({ slug }),
    });
  const openApiResponse = await fetch(`${origin}/agent-native/v1/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json();
  assert.ok(Object.hasOwn(openApi.paths, invocation));
  assert.equal(openApi.paths[invocation].post.summary, 'Look up one public sample album by slug.');
  assert.equal((await invoke('night-bus-radio', '')).status, 404);
  assert.equal((await invoke('not valid')).status, 422);
  assert.deepEqual(await (await invoke('night-bus-radio')).json(), {
    kind: 'found',
    album: {
      slug: 'night-bus-radio',
      title: 'Night Bus Radio',
      artist: 'The Meridian Lines',
      year: 1983,
      format: 'LP',
      summary: 'Lean post-punk recorded between the last train and the first morning bus.',
    },
  });

  const client = new Client({ name: 'e02-local-check', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: 'Bearer e02-local-fixture' } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 1);
    const result = await client.callTool({
      name: tools.tools[0].name,
      arguments: { slug: 'night-bus-radio' },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(
      result.structuredContent.result,
      await (await invoke('night-bus-radio')).json(),
    );
    const invalid = await client.callTool({
      name: tools.tools[0].name,
      arguments: { slug: 'not valid' },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }

  const anonymousClient = new Client({ name: 'e02-anonymous-check', version: '1.0.0' });
  const anonymousTransport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await anonymousClient.connect(anonymousTransport);
  try {
    const tools = await anonymousClient.listTools();
    assert.equal(tools.tools.length, 1);
    assert.equal(
      tools.tools[0].description,
      'Look up one public sample album by slug. Returns the contract value under structuredContent.result.',
    );
    const denied = await anonymousClient.callTool({
      name: tools.tools[0].name,
      arguments: { slug: 'night-bus-radio' },
    });
    assert.equal(denied.isError, true);
  } finally {
    await anonymousClient.close();
  }
} catch (error) {
  throw new Error(`${error.message}\nServer output:\n${output}`, { cause: error });
} finally {
  await stop(child);
}

process.stdout.write('E02 live Astro HTTP/MCP verification passed.\n');
