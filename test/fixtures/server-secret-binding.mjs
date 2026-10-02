import { bindCapability } from '../../dist/index.js';

export const secretSentinel = 'SERVER_SECRET_SENTINEL_MUST_NEVER_ENTER_BROWSER_BUILD';

/** @param {{ readonly slug: string }} input */
export function serverOnlyLookup(input) {
  return {
    kind: 'found',
    album: { slug: input.slug, title: secretSentinel },
  };
}

/** @param {import('../../dist/index.js').CapabilityDefinition<unknown, unknown>} definition */
export function bindServerOnly(definition) {
  return bindCapability(definition, {
    id: 'server-catalog',
    targets: ['server'],
    execute: serverOnlyLookup,
  });
}
