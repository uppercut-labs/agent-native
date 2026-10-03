import { bindCapability, createCapabilityRegistry } from '@uppercut-labs/agent-native';
import { CATALOG_REVISION, getAlbumCapability, lookupAlbum } from './catalog-contract.mjs';

export const catalogRevision = CATALOG_REVISION;
const serverBinding = bindCapability(getAlbumCapability, {
  id: 'worker-sample-catalog',
  targets: ['server'],
  execute: lookupAlbum,
});
export const registry = createCapabilityRegistry([getAlbumCapability], [serverBinding]);
