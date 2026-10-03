import { albumLookupV1 } from '@example/e08-album-contracts';
import { bindCapability } from '@uppercut-labs/agent-native';
import { lookupAlbum } from './catalog-data.mjs';

export const legacyBinding = bindCapability(albumLookupV1, {
  id: 'legacy-consumer',
  targets: ['local'],
  execute(input) {
    const album = lookupAlbum(input.slug);
    return { slug: album.slug, title: album.titles['en-US'] };
  },
});
