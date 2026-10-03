import { albumLookupV2 } from '@example/e08-album-contracts';
import { bindCapability } from '@uppercut-labs/agent-native';
import { lookupAlbum } from './catalog-data.mjs';

export const localizedBinding = bindCapability(albumLookupV2, {
  id: 'localized-consumer',
  targets: ['local'],
  execute(input) {
    const album = lookupAlbum(input.slug);
    if (album.titles[input.locale] === undefined)
      throw new TypeError(`unsupported locale ${input.locale}`);
    return { slug: album.slug, locale: input.locale, titles: album.titles };
  },
});
