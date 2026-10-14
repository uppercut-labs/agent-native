import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { defineCapability } from '@uppercut-labs/agent-native/contracts';
import { bindCapability, createCapabilityRegistry } from '@uppercut-labs/agent-native/registry';
import { createMcpHandler, mcpToolName } from '@uppercut-labs/agent-native/mcp';
import { publicReadAuthorization, searchContentCapability } from './src/capability.mjs';
import { searchContent } from './src/existing/content.mjs';
import { createContentServer } from './src/http.mjs';

let calls = 0;
let hiddenCalls = 0;
const counted = bindCapability(searchContentCapability, {
  id: 'counted-existing-search',
  targets: ['server'],
  execute: async (input) => {
    calls++;
    return searchContent(input);
  },
});
const hidden = defineCapability({
  identity: { namespace: 'content', name: 'private-search', majorVersion: 1 },
  description: 'PRIVATE_DISCOVERY_CANARY',
  input: searchContentCapability.input,
  output: searchContentCapability.output,
  risk: 'read',
  access: { kind: 'protected', scopes: ['private:read'] },
});
const hiddenBinding = bindCapability(hidden, {
  id: 'hidden-search',
  targets: ['server'],
  execute: async (input) => {
    hiddenCalls++;
    return searchContent(input);
  },
});
const registry = createCapabilityRegistry(
  [searchContentCapability, hidden],
  [counted, hiddenBinding],
);
const handler = createMcpHandler(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body =
    incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Buffer.concat(chunks);
  const response = await handler(
    new Request('http://127.0.0.1' + incoming.url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(body ? { body } : {}),
    }),
  );
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
const humanServer = createContentServer();
const client = new Client({ name: 'adoption-clean-consumer', version: '1.0.0' });
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => humanServer.listen(0, '127.0.0.1', resolve));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)),
  );
  const tools = (await client.listTools()).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [mcpToolName(searchContentCapability.identity)],
  );
  assert.ok(!JSON.stringify(tools).includes('PRIVATE_DISCOVERY_CANARY'));
  const result = await client.callTool({
    name: tools[0].name,
    arguments: { query: 'night', limit: 1 },
  });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.deepEqual(
    result.structuredContent.result.results.map((item) => item.slug),
    ['night-drive'],
  );
  const invalid = await client.callTool({ name: tools[0].name, arguments: { query: '' } });
  assert.equal(invalid.isError, true);
  await assert.rejects(
    client.callTool({ name: mcpToolName(hidden.identity), arguments: { query: 'night' } }),
  );
  assert.equal(calls, 1);
  assert.equal(hiddenCalls, 0);
  const origin = `http://127.0.0.1:${humanServer.address().port}`;
  assert.equal((await fetch(origin + '/api/content/city-map')).status, 200);
  assert.equal((await fetch(origin + '/api/content/search?q=night')).status, 200);
  assert.equal((await fetch(origin + '/api/content/search')).status, 422);
  assert.equal(
    (await fetch(origin + '/api/content/search?q=night', { method: 'POST' })).status,
    405,
  );
  console.log(
    'Published 1.0.0 consumer: actual HTTP and official MCP sockets; existing reads, invalid-before-handler, hidden denial and preserved human routes PASS.',
  );
} finally {
  await client.close();
  await Promise.all([server, humanServer].map((s) => new Promise((resolve) => s.close(resolve))));
}
