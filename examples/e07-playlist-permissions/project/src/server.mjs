import { createServer as createNodeServer } from 'node:http';
import * as z from 'zod';
import { createMcpHandler } from '@uppercut-labs/agent-native/mcp';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  hasGrantForScopes,
} from '@uppercut-labs/agent-native';
import { JsonFileGrantStore } from './grant-store.mjs';
import { JsonFilePlaylistStore } from './playlist-store.mjs';
import { createTestVerifier, E07_RESOURCE, resolveTestPrincipal } from './test-auth.mjs';

const APPLICATION_ID = 'e07-playlist-permissions';
const POLICY_REVISION = 'playlist-policy-v1';

export async function createE07Service({ grantPath, playlistPath }) {
  if (process.env.NODE_ENV === 'production' || process.env.UAN_E07_TEST_MODE !== '1') {
    throw new Error('E07 is a disposable local fixture and refuses production mode.');
  }
  if (typeof grantPath !== 'string' || typeof playlistPath !== 'string') {
    throw new TypeError('grantPath and playlistPath must point to explicit local fixture files.');
  }

  const grants = new JsonFileGrantStore(grantPath);
  const playlists = new JsonFilePlaylistStore(playlistPath);
  const list = defineCapability({
    identity: { namespace: 'e07.playlists', name: 'list-public', majorVersion: 1 },
    description: 'List public sample playlists.',
    input: fromZod(z.object({})),
    output: fromZod(
      z.object({ playlists: z.array(z.object({ id: z.string(), title: z.string() })) }),
    ),
    risk: 'read',
    access: { kind: 'public' },
  });
  const edit = defineCapability({
    identity: { namespace: 'e07.playlists', name: 'edit', majorVersion: 1 },
    description: 'Edit a playlist owned by the authenticated tenant.',
    input: fromZod(z.object({ playlistId: z.string(), title: z.string().min(1).max(80) })),
    output: fromZod(z.object({ updated: z.boolean(), title: z.string() })),
    risk: 'write',
    access: { kind: 'protected', scopes: ['playlist:edit'] },
  });
  const remove = defineCapability({
    identity: { namespace: 'e07.playlists', name: 'delete', majorVersion: 1 },
    description: 'Delete a playlist owned by the authenticated tenant.',
    input: fromZod(z.object({ playlistId: z.string() })),
    output: fromZod(z.object({ deleted: z.boolean() })),
    risk: 'destructive',
    access: { kind: 'protected', scopes: ['playlist:delete'] },
  });
  const listBinding = bindCapability(list, {
    id: 'e07-public-list',
    targets: ['server'],
    execute: async () => ({
      playlists: (await playlists.listPublic()).map(({ id, title }) => ({ id, title })),
    }),
  });
  const editBinding = bindCapability(edit, {
    id: 'e07-edit',
    targets: ['server'],
    execute: async ({ playlistId, title }) => {
      const updated = await playlists.edit(playlistId, title);
      return { updated: updated !== null, title: updated?.title ?? '' };
    },
  });
  const deleteBinding = bindCapability(remove, {
    id: 'e07-delete',
    targets: ['server'],
    execute: async ({ playlistId }) => ({ deleted: await playlists.delete(playlistId) }),
  });
  const registry = createCapabilityRegistry(
    [list, edit, remove],
    [listBinding, editBinding, deleteBinding],
  );

  const handler = createMcpHandler(registry, {
    bearerAuth: {
      verifier: createTestVerifier(),
      expectedResource: new URL(E07_RESOURCE),
    },
    resolveTrustedPrincipal: resolveTestPrincipal,
    grantAuthorization: {
      applicationId: APPLICATION_ID,
      audience: E07_RESOURCE,
      policyRevision: POLICY_REVISION,
      store: grants,
      authorizeResource: async (request, principal) => {
        const playlist = await playlists.get(request.input.playlistId);
        return playlist !== null && playlist.tenantId === principal.tenantId;
      },
    },
    discoverProtected: async (definition, _request, authInfo) => {
      const principal = resolveTestPrincipal(authInfo);
      if (principal === null || definition.access.kind !== 'protected') return false;
      return await hasGrantForScopes({
        principal,
        applicationId: APPLICATION_ID,
        audience: E07_RESOURCE,
        policyRevision: POLICY_REVISION,
        store: grants,
        requiredScopes: definition.access.scopes,
      });
    },
  });

  return { handler, grants, playlists };
}

export async function listenE07(handler, port = 0) {
  const server = createNodeServer(async (incoming, outgoing) => {
    try {
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
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'fixture request failed' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('fixture server did not bind a TCP port');
  return {
    origin: 'http://127.0.0.1:' + address.port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const grantPath = process.env.E07_GRANTS_PATH;
  const playlistPath = process.env.E07_PLAYLISTS_PATH;
  const port = Number(process.env.PORT ?? 0);
  const { handler } = await createE07Service({ grantPath, playlistPath });
  const server = await listenE07(handler, port);
  process.stdout.write('READY ' + server.origin + '\n');
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
