import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
} from '@uppercut-labs/agent-native';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';

const input = fromZod(
  z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  }),
);
const output = fromZod(
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('found'),
      album: z.object({ slug: z.string(), title: z.string() }),
    }),
    z.object({ kind: z.literal('missing') }),
  ]),
);

export const albumLookup = defineCapability({
  identity: { namespace: 'example.catalog', name: 'album.lookup', majorVersion: 1 },
  description: 'Look up one public sample album by slug.',
  input,
  output,
  risk: 'read',
  access: { kind: 'public' },
});
const albums = new Map([['first-light', { slug: 'first-light', title: 'First Light' }]]);
const handler = async ({ slug }) => {
  const album = albums.get(slug);
  return album === undefined ? { kind: 'missing' } : { kind: 'found', album };
};
export const localBinding = bindCapability(albumLookup, {
  id: 'local-album-catalog',
  targets: ['local'],
  execute: handler,
});
export const serverBinding = bindCapability(albumLookup, {
  id: 'server-album-catalog',
  targets: ['server'],
  execute: handler,
});
export const registry = createCapabilityRegistry([albumLookup], [localBinding, serverBinding]);

export function createAuthorization() {
  return {
    authorize(request) {
      if (request.access.kind !== 'public' || request.risk !== 'read') return false;
      return request.caller.kind === 'anonymous' || request.caller.scopes.includes('catalog:read');
    },
  };
}
export const httpHandler = createHttpHandler(registry, {
  resolveExecutionContext: httpHandlerContext,
});

export function createThrowingHttpHandler() {
  const failingBinding = bindCapability(albumLookup, {
    id: 'server-handler-failure',
    targets: ['server'],
    execute: async () => {
      throw new Error('HANDLER_SECRET_SENTINEL');
    },
  });
  const failingRegistry = createCapabilityRegistry([albumLookup], [failingBinding]);
  return createHttpHandler(failingRegistry, {
    resolveExecutionContext: httpHandlerContext,
  });
}

function httpHandlerContext(request) {
  const token = request.headers.get('authorization');
  const authenticated = token === 'Bearer ' + process.env.E05_TOKEN;
  const caller = authenticated
    ? { kind: 'authenticated', subject: 'demo-cli', scopes: ['catalog:read'] }
    : { kind: 'anonymous' };
  return {
    caller,
    authorization: {
      authorize(request) {
        return (
          request.risk === 'read' &&
          request.access.kind === 'public' &&
          request.caller.kind === 'authenticated' &&
          request.caller.scopes.includes('catalog:read')
        );
      },
    },
  };
}
