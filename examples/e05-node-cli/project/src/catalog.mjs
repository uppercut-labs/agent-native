import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
} from '@uppercut-labs/agent-native';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { createMcpHandler } from '@uppercut-labs/agent-native/mcp';
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
const handler = async ({ slug }, context) => {
  if (slug === 'bounded-wait' && context.runtime === 'server') {
    while (context.signal?.aborted !== true) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('bounded operation aborted');
  }
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

function serverExecutionContext(request, allowAnonymous) {
  const expectedToken = process.env.E05_TOKEN;
  const authenticated =
    typeof expectedToken === 'string' &&
    expectedToken.length > 0 &&
    request.headers.get('authorization') === `Bearer ${expectedToken}`;
  const caller = authenticated
    ? { kind: 'authenticated', subject: 'demo-cli', scopes: ['catalog:read'] }
    : { kind: 'anonymous' };
  return {
    caller,
    authorization: {
      authorize(execution) {
        if (execution.risk !== 'read' || execution.access.kind !== 'public') return false;
        return (
          allowAnonymous ||
          (execution.caller.kind === 'authenticated' &&
            execution.caller.scopes.includes('catalog:read'))
        );
      },
    },
  };
}

export const httpHandler = createHttpHandler(registry, {
  deadlineMs: 100,
  resolveExecutionContext: (request) => serverExecutionContext(request, false),
});
export const mcpHandler = createMcpHandler(registry, {
  deadlineMs: 100,
  resolveExecutionContext: (request) => serverExecutionContext(request, true),
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
    resolveExecutionContext: (request) => serverExecutionContext(request, false),
  });
}
