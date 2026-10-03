import {
  bindCapability,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import {
  CATALOG_REVISION,
  getAlbumCapability,
  lookupAlbum,
  publicAlbums,
} from './catalog-contract.mjs';

export { CATALOG_REVISION, getAlbumCapability, lookupAlbum, publicAlbums };
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
