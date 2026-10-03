import { defineCapability } from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';
import { publicAlbums } from './data/albums.mjs';
export const CATALOG_REVISION =
  'sha256:9748f47e7e0eca26acd3e5b0fe30c6227242ea7abeb4f62beab76b68b064d7c6';

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
export { publicAlbums };
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
  return album === undefined ? { kind: 'missing' } : { kind: 'found', album };
}
