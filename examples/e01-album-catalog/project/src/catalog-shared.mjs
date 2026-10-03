import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';
import { publicAlbums } from './data/albums.mjs';
export { publicAlbums } from './data/albums.mjs';

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

const albums = new Map(publicAlbums.map((album) => [album.slug, album]));

/** @param {{ slug: string }} input */
export function lookupAlbum(input) {
  const album = albums.get(input.slug);
  if (album === undefined) return { kind: 'missing' };
  return { kind: 'found', album };
}

export const browserAlbumBinding = bindCapability(getAlbumCapability, {
  id: 'browser-sample-catalog',
  targets: ['browser'],
  execute: lookupAlbum,
});

export const browserCatalogRegistry = createCapabilityRegistry(
  [getAlbumCapability],
  [browserAlbumBinding],
);

const publicReadAuthorization = {
  authorize(request) {
    return request.risk === 'read' && request.access.kind === 'public';
  },
};

export function runBrowserAlbumLookup(input) {
  return executeCapability(browserCatalogRegistry, {
    identity: getAlbumCapability.identity,
    runtime: 'browser',
    bindingId: browserAlbumBinding.id,
    input,
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  });
}
