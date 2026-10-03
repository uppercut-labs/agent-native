import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
} from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';
import { findAlbumBySlug } from './data/albums.mjs';

const album = z.object({
  slug: z.string(),
  title: z.string(),
  artist: z.string(),
  year: z.number().int(),
  format: z.string(),
  summary: z.string(),
});

// docs:start astro-album-contract
export const albumLookup = defineCapability({
  identity: { namespace: 'example.catalog', name: 'album.lookup', majorVersion: 1 },
  description: 'Look up one public sample album by slug.',
  input: fromZod(z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })),
  output: fromZod(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('found'), album }),
      z.object({ kind: z.literal('missing') }),
    ]),
  ),
  risk: 'read',
  access: { kind: 'public' },
});
// docs:end astro-album-contract

export function lookupAlbum({ slug }) {
  const found = findAlbumBySlug(slug);
  return found === undefined ? { kind: 'missing' } : { kind: 'found', album: found };
}

const serverBinding = bindCapability(albumLookup, {
  id: 'astro-on-demand-catalog',
  targets: ['server'],
  execute: lookupAlbum,
});

export const registry = createCapabilityRegistry([albumLookup], [serverBinding]);

export function resolveExecutionContext(request) {
  const authenticated = request.headers.get('authorization') === 'Bearer e02-local-fixture';
  return {
    caller: authenticated
      ? { kind: 'authenticated', subject: 'e02-local-client', scopes: ['catalog:read'] }
      : { kind: 'anonymous' },
    authorization: {
      authorize(call) {
        return (
          call.risk === 'read' &&
          call.access.kind === 'public' &&
          call.caller.kind === 'authenticated' &&
          call.caller.scopes.includes('catalog:read')
        );
      },
    },
  };
}
