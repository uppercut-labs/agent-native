import {
  bindCapability,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { getAlbumCapability, lookupAlbum } from './catalog-contract.mjs';

export { getAlbumCapability } from './catalog-contract.mjs';

const localAlbumBinding = bindCapability(getAlbumCapability, {
  id: 'local-sample-catalog',
  targets: ['local'],
  execute: lookupAlbum,
});

const serverAlbumBinding = bindCapability(getAlbumCapability, {
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

// docs:start local-album-execution
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
// docs:end local-album-execution

export const albumHttpHandler = createHttpHandler(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});
