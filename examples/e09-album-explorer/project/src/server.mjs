import { createServer as createNodeServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindCapability, createCapabilityRegistry } from '@uppercut-labs/agent-native';
import { canonicalCapabilityId } from '@uppercut-labs/agent-native';
import { createMcpAppsHandler } from '@uppercut-labs/agent-native/mcp-apps';
import { getAlbumCapability, lookupAlbum } from './catalog-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceUri = 'ui://uppercut/album-explorer.html';
let handlerCalls = 0;

const serverBinding = bindCapability(getAlbumCapability, {
  id: 'e09-server-album-catalog',
  targets: ['server'],
  execute: async (input) => {
    handlerCalls += 1;
    return lookupAlbum(input);
  },
});
export const registry = createCapabilityRegistry([getAlbumCapability], [serverBinding]);
const authorization = {
  authorize(request) {
    return (
      request.risk === 'read' &&
      request.access.kind === 'public' &&
      request.input.slug !== 'blocked-album'
    );
  },
};

export const albumToolName = 'cap_15_example.catalog_12_album.lookup_v1';
export const albumResourceUri = resourceUri;
export function getHandlerCalls() {
  return handlerCalls;
}

export async function createE09Handler() {
  const html = await readFile(path.join(root, 'dist/mcp-app.html'), 'utf8');
  return createMcpAppsHandler(registry, {
    resources: [
      {
        capabilityId: canonicalCapabilityId(getAlbumCapability.identity),
        uri: resourceUri,
        name: 'Album explorer',
        html,
      },
    ],
    resolveExecutionContext: () => ({
      caller: { kind: 'anonymous' },
      authorization,
    }),
  });
}

export async function startE09Server() {
  const handler = await createE09Handler();
  const server = createNodeServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(key, value.join(', '));
      else if (value !== undefined) headers.set(key, value);
    }
    const response = await handler(
      new Request(new URL(incoming.url, 'http://127.0.0.1'), {
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
  if (address === null || typeof address === 'string') throw new Error('Loopback listener failed.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await import('./demo.mjs').then(({ runDemo }) => runDemo());
}
