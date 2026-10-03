import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { httpInvocationPath } from '@uppercut-labs/agent-native/http';
import { mcpToolName } from '@uppercut-labs/agent-native/mcp';
import { POST as postCapability } from '../app/agent-native/[...path]/route.js';
import { GET as getCatalog } from '../app/api/catalog/route.js';
import { GET as getSavedList } from '../app/api/saved-list/route.js';
import { POST as postMcp } from '../app/mcp/route.js';
import { catalogCapability } from '../lib/catalog-capability.js';

const catalogResponse = await getCatalog(new Request('http://localhost/api/catalog'));
assert.equal(catalogResponse.status, 200);
const catalogBody = await catalogResponse.json();
assert.equal(catalogBody.items.length, 4);

for (const headers of [{}, { authorization: 'Bearer invalid-session' }]) {
  const deniedResponse = await getSavedList(
    new Request('http://localhost/api/saved-list', { headers }),
  );
  assert.equal(deniedResponse.status, 401);
  assert.equal(deniedResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await deniedResponse.json(), {
    error: { code: 'unauthorized', message: 'A valid fixture session is required.' },
  });
}

const alexResponse = await getSavedList(
  new Request('http://localhost/api/saved-list?ownerUserId=reader-mina', {
    headers: { authorization: 'Bearer fixture-session-alex' },
  }),
);
assert.equal(alexResponse.status, 200);
assert.equal(alexResponse.headers.get('cache-control'), 'private, no-store');
assert.deepEqual(await alexResponse.json(), { items: ['braiding-sweetgrass'] });

const capabilityResponse = await postCapability(
  new Request(`http://localhost${httpInvocationPath(catalogCapability.identity)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }),
);
assert.equal(capabilityResponse.status, 200);
assert.equal((await capabilityResponse.json()).items.length, 4);

const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, value);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const response = await postMcp(
    new Request(`http://127.0.0.1${incoming.url}`, {
      method: incoming.method,
      headers,
      ...(body === undefined ? {} : { body }),
    }),
  );
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address !== 'string');
const client = new Client({ name: 'e03-next-fixture', version: '1.0.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)),
  );
  const toolName = mcpToolName(catalogCapability.identity);
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name),
    [toolName],
  );
  const result = await client.callTool({ name: toolName, arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.result.items.length, 4);
} finally {
  await client.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

console.log('route smoke: existing routes, Next HTTP adapter, and official MCP client passed');
