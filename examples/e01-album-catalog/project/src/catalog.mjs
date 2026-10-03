import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';

const albumLookupInput = fromZod(
  z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  }),
);
const albumLookupOutput = fromZod(
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('found'),
      album: z.object({ slug: z.string(), title: z.string() }),
    }),
    z.object({ kind: z.literal('missing') }),
  ]),
);

export const getAlbumCapability = defineCapability({
  identity: { namespace: 'example.catalog', name: 'album.lookup', majorVersion: 1 },
  description: 'Look up a public sample album by its slug.',
  input: albumLookupInput,
  output: albumLookupOutput,
  risk: 'read',
  access: { kind: 'public' },
});

const albums = new Map([['first-light', { slug: 'first-light', title: 'First Light' }]]);

/** @type {import('@uppercut-labs/agent-native').CapabilityBindingOptions<
 * z.output<typeof albumLookupInput>, z.output<typeof albumLookupOutput>
 * >['execute']} */
async function lookupAlbum(input) {
  const album = albums.get(input.slug);
  if (album === undefined) {
    return { kind: 'missing' };
  }
  return { kind: 'found', album };
}

export const localAlbumBinding = bindCapability(getAlbumCapability, {
  id: 'local-sample-catalog',
  targets: ['local'],
  execute: lookupAlbum,
});

export const serverAlbumBinding = bindCapability(getAlbumCapability, {
  id: 'server-sample-catalog',
  targets: ['server'],
  execute: lookupAlbum,
});

const registry = createCapabilityRegistry(
  [getAlbumCapability],
  [localAlbumBinding, serverAlbumBinding],
);

/** @type {import('@uppercut-labs/agent-native').AuthorizationPort} */
const publicReadAuthorization = {
  authorize(request) {
    return request.risk === 'read' && request.access.kind === 'public';
  },
};

/** @param {unknown} input */
export function runAlbumLookup(input) {
  return executeCapability(registry, {
    identity: getAlbumCapability.identity,
    runtime: 'local',
    input,
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  });
}

export const albumHttpHandler = createHttpHandler(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});
