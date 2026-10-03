import { createBrowserCapabilityAdapter } from '@uppercut-labs/agent-native/browser';
import { browserCatalogRegistry, runBrowserAlbumLookup } from './catalog-shared.mjs';
import { installAstroCatalog } from './astro-catalog.mjs';

installAstroCatalog(document, {
  registry: browserCatalogRegistry,
  createAdapter: createBrowserCapabilityAdapter,
  lookup: runBrowserAlbumLookup,
  onStatus(message) {
    const status = document.querySelector('[data-agent-status]');
    if (status !== null) status.textContent = message;
  },
});
