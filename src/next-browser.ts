import {
  createBrowserCapabilityAdapter,
  type BrowserAdapterOptions,
  type BrowserCapabilityAdapter,
  type BrowserDocumentLike,
  type BrowserSyncReport,
} from './browser.js';
import type { CapabilityRegistry } from './core/registry.js';

export type NextBrowserBootstrap = {
  readonly supported: boolean;
  /** Call from a client component whenever usePathname() changes. */
  sync(): Promise<BrowserSyncReport>;
  dispose(): void;
};

/**
 * Keeps the framework-neutral browser adapter separate from server route code.
 * Next does not expose a stable DOM navigation event, so callers explicitly resync from usePathname().
 */
export function createNextBrowserBootstrap(
  document: BrowserDocumentLike,
  registry: CapabilityRegistry,
  options: BrowserAdapterOptions = {},
): NextBrowserBootstrap {
  const adapter: BrowserCapabilityAdapter = createBrowserCapabilityAdapter(document);
  return {
    supported: adapter.supported,
    sync: () => adapter.sync(registry, options),
    dispose: () => adapter.dispose(),
  };
}
