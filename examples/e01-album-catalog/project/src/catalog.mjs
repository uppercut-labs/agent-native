import {
  bindCapability,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { getAlbumCapability, lookupAlbum } from './catalog-shared.mjs';

export { getAlbumCapability } from './catalog-shared.mjs';

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
