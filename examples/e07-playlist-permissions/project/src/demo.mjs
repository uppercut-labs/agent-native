import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createE07Service, listenE07 } from './server.mjs';

if (process.env.NODE_ENV === 'production') {
  throw new Error('E07 static test identities are unavailable in production mode.');
}
process.env.NODE_ENV = 'test';
process.env.UAN_E07_TEST_MODE = '1';

const parent = await mkdtemp(path.join(os.tmpdir(), 'uan-e07-demo-'));
let server;
let client;
try {
  const { handler } = await createE07Service({
    grantPath: path.join(parent, 'grants.json'),
    playlistPath: path.join(parent, 'playlists.json'),
  });
  server = await listenE07(handler);
  client = new Client({ name: 'e07-playlist-demo', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'));
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  const result = await client.callTool({
    name: tools[0].name,
    arguments: {},
  });
  process.stdout.write(JSON.stringify(result.structuredContent.result) + '\n');
} finally {
  if (client) await client.close().catch(() => {});
  if (server) await server.close();
  await rm(parent, { recursive: true, force: true });
}
