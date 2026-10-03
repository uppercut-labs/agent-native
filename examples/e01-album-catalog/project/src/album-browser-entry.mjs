import { createBrowserCapabilityAdapter } from '@uppercut-labs/agent-native/browser';
import {
  browserCatalogRegistry,
  CATALOG_REVISION,
  runBrowserAlbumLookup,
} from './catalog-shared.mjs';
import { installAstroCatalog } from './astro-catalog.mjs';
import { installSidecarDiagnostics } from './sidecar-diagnostics.mjs';

installAstroCatalog(document, {
  registry: browserCatalogRegistry,
  createAdapter: createBrowserCapabilityAdapter,
  lookup: runBrowserAlbumLookup,
  onStatus(message) {
    const status = document.querySelector('[data-agent-status]');
    if (status !== null) status.textContent = message;
  },
});
installSidecarDiagnostics(document, {
  pageOrigin: location.origin,
  browserRevision: CATALOG_REVISION,
});
