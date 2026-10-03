import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createBrowserCapabilityAdapter } from '@uppercut-labs/agent-native/browser';
import { agentNativeAstro } from '@uppercut-labs/agent-native/astro';
import {
  CATALOG_REVISION,
  publicAlbums,
  browserCatalogRegistry,
  getAlbumCapability,
  runBrowserAlbumLookup,
} from '../src/catalog-shared.mjs';
import { installAstroCatalog } from '../src/astro-catalog.mjs';
import { diagnoseSidecar, installSidecarDiagnostics } from '../src/sidecar-diagnostics.mjs';

class Events {
  listeners = new Map();

  addEventListener(type, listener) {
    const items = this.listeners.get(type) ?? new Set();
    items.add(listener);
    this.listeners.set(type, items);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function makeDocument({ catalog = true, supported = true } = {}) {
  const docEvents = new Events();
  const windowEvents = new Events();
  const active = new Map();
  const registrations = [];
  const status = [];
  const modelContext = supported
    ? {
        async registerTool(tool, { signal } = {}) {
          registrations.push(tool);
          active.set(tool.name, { tool, signal });
          signal?.addEventListener(
            'abort',
            () => {
              if (active.get(tool.name)?.tool === tool) active.delete(tool.name);
            },
            { once: true },
          );
        },
      }
    : undefined;

  const document = {
    defaultView: windowEvents,
    ...(modelContext === undefined ? {} : { modelContext }),
    addEventListener: docEvents.addEventListener.bind(docEvents),
    removeEventListener: docEvents.removeEventListener.bind(docEvents),
    dispatch: docEvents.dispatch.bind(docEvents),
    listenerCount: docEvents.listenerCount.bind(docEvents),
    querySelector(selector) {
      if (selector === '[data-album-catalog]') return catalog ? {} : null;
      return null;
    },
    setCatalog(value) {
      catalog = value;
    },
  };

  return { document, active, registrations, status, windowEvents };
}

test('Astro browser lifecycle stays deduplicated and uses the shared album capability', async () => {
  const fixture = makeDocument();
  const installation = installAstroCatalog(fixture.document, {
    registry: browserCatalogRegistry,
    createAdapter: createBrowserCapabilityAdapter,
    lookup: runBrowserAlbumLookup,
    onStatus: (message) => fixture.status.push(message),
  });
  assert.strictEqual(
    installAstroCatalog(fixture.document, {
      registry: browserCatalogRegistry,
      createAdapter: createBrowserCapabilityAdapter,
      lookup: runBrowserAlbumLookup,
    }),
    installation,
  );
  await installation.whenReady();
  assert.equal(fixture.document.listenerCount('astro:page-load'), 1);
  assert.equal(fixture.active.size, 1);

  const first = [...fixture.active.values()][0];
  assert.ok(first);
  const result = await first.tool.execute(
    { slug: 'first-light' },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(result, {
    ok: true,
    capabilityId: 'example.catalog:album.lookup@1',
    value: {
      kind: 'found',
      album: { slug: 'first-light', title: 'First Light' },
    },
  });

  fixture.document.dispatch('astro:page-load');
  await installation.whenReady();
  assert.equal(fixture.active.size, 1);
  assert.equal(fixture.registrations.length, 2);
});

test('Astro navigation, pagehide, and bfcache pageshow revoke and restore registration', async () => {
  const fixture = makeDocument();
  const installation = installAstroCatalog(fixture.document, {
    registry: browserCatalogRegistry,
    createAdapter: createBrowserCapabilityAdapter,
    lookup: runBrowserAlbumLookup,
  });
  await installation.whenReady();
  const first = [...fixture.active.values()][0];
  assert.ok(first);

  fixture.document.dispatch('astro:before-swap');
  assert.equal(fixture.active.size, 0);
  fixture.document.setCatalog(false);
  fixture.document.dispatch('astro:page-load');
  await installation.whenReady();
  assert.equal(fixture.active.size, 0);

  fixture.document.setCatalog(true);
  fixture.document.dispatch('astro:page-load');
  await installation.whenReady();
  assert.equal(fixture.active.size, 1);
  assert.equal(first.signal?.aborted, true);

  fixture.windowEvents.dispatch('pagehide');
  assert.equal(fixture.active.size, 0);
  fixture.windowEvents.dispatch('pageshow');
  await installation.whenReady();
  assert.equal(fixture.active.size, 1);
  assert.equal(fixture.registrations.length, 3);
  installation.dispose();
  assert.equal(fixture.active.size, 0);
});

test('unsupported WebMCP keeps human album lookup available', async () => {
  const fixture = makeDocument({ supported: false });
  const resultOutput = { textContent: '' };
  const slugInput = { value: 'blue-hour' };
  const form = {
    matches: (selector) => selector === 'form[data-album-lookup]',
    querySelector(selector) {
      if (selector === 'input[name="slug"]') return slugInput;
      if (selector === '[data-lookup-result]') return resultOutput;
      return null;
    },
  };
  const installation = installAstroCatalog(fixture.document, {
    registry: browserCatalogRegistry,
    createAdapter: createBrowserCapabilityAdapter,
    lookup: runBrowserAlbumLookup,
    onStatus: (message) => fixture.status.push(message),
  });
  await installation.whenReady();
  assert.match(fixture.status.at(-1), /You can still search the catalog below/);

  let prevented = false;
  fixture.document.dispatch('submit', { target: form, preventDefault: () => (prevented = true) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(
    resultOutput.textContent,
    '{"kind":"found","album":{"slug":"blue-hour","title":"Blue Hour"}}',
  );
  installation.dispose();
});

test('Astro integration injects a bundled page entry and rejects server output', async () => {
  const integration = agentNativeAstro({ browserEntry: '/fixture/src/browser-entry.mjs' });
  let injected;
  const messages = [];
  const logger = {
    info: (message) => messages.push(message),
    warn: (message) => messages.push(message),
  };
  await integration.hooks['astro:config:setup']({
    config: { output: 'static' },
    injectScript: (stage, script) => (injected = { stage, script }),
    logger,
  });
  await integration.hooks['astro:config:done']({ buildOutput: 'static', logger });
  assert.deepEqual(injected, {
    stage: 'page',
    script: 'import "/fixture/src/browser-entry.mjs";',
  });
  assert.ok(messages.some((message) => message.includes('verified static output')));

  let serverInjected = false;
  const serverIntegration = agentNativeAstro({ browserEntry: '/fixture/server-entry.mjs' });
  await serverIntegration.hooks['astro:config:setup']({
    config: { output: 'server' },
    injectScript: () => (serverInjected = true),
    logger,
  });
  assert.equal(serverInjected, false);
  assert.throws(
    () => serverIntegration.hooks['astro:config:done']({ buildOutput: 'server', logger }),
    /Use output: "static", or set mode: "on-demand"/,
  );
});

test('Astro integration requires an absolute browser entry path', () => {
  assert.throws(() => agentNativeAstro({ browserEntry: './src/entry.mjs' }), /absolute/);
  assert.equal(getAlbumCapability.identity.name, 'album.lookup');
});

test('sidecar diagnostics distinguish origin, route, binding, and revision failures', () => {
  const base = {
    pageOrigin: 'https://catalog.example.test',
    sidecarOrigin: 'https://api.example.test',
    browserRevision: 'sha256:9748f47e7e0eca26acd3e5b0fe30c6227242ea7abeb4f62beab76b68b064d7c6',
  };
  assert.equal(
    diagnoseSidecar({
      ...base,
      sidecarHealth: { status: 'ok', catalogRevision: base.browserRevision },
    }).kind,
    'sidecar-origin-differs',
  );
  assert.equal(
    diagnoseSidecar({
      ...base,
      sameOriginMcpStatus: 404,
      expectedRouteMode: 'same-origin',
      sidecarHealth: { status: 'ok', catalogRevision: base.browserRevision },
    }).kind,
    'same-origin-route-missing',
  );
  assert.equal(
    diagnoseSidecar({
      ...base,
      sidecarHealth: { status: 'unavailable', code: 'missing_catalog_binding' },
    }).kind,
    'missing-catalog-binding',
  );
  assert.equal(
    diagnoseSidecar({ ...base, sidecarHealth: { status: 'ok', catalogRevision: 'other' } }).kind,
    'catalog-revision-mismatch',
  );
});

test('sidecar status refreshes on Astro navigation and pageshow without probing /mcp in direct mode', async () => {
  const documentEvents = new Events();
  const windowEvents = new Events();
  const section = {
    getAttribute(name) {
      return name === 'data-sidecar-origin' ? 'https://api.example.test' : 'sidecar';
    },
  };
  const status = { textContent: '' };
  const document = {
    defaultView: windowEvents,
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    querySelector(selector) {
      if (selector === '[data-album-catalog]') return section;
      if (selector === '[data-sidecar-status]') return status;
      return null;
    },
    dispatch: documentEvents.dispatch.bind(documentEvents),
  };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return {
      status: 200,
      json: async () => ({
        status: 'ok',
        catalogRevision: 'sha256:9748f47e7e0eca26acd3e5b0fe30c6227242ea7abeb4f62beab76b68b064d7c6',
      }),
    };
  };
  const installation = installSidecarDiagnostics(document, {
    pageOrigin: 'https://catalog.example.test',
    browserRevision: 'sha256:9748f47e7e0eca26acd3e5b0fe30c6227242ea7abeb4f62beab76b68b064d7c6',
    fetcher,
  });
  await installation.whenReady();
  assert.equal(calls.length, 1);
  assert.match(status.textContent, /separate sidecar URL/);
  document.dispatch('astro:page-load');
  await installation.whenReady();
  windowEvents.dispatch('pageshow');
  await installation.whenReady();
  assert.equal(calls.length, 3);
  assert.equal(documentEvents.listenerCount('astro:page-load'), 1);
  assert.equal(windowEvents.listenerCount('pageshow'), 1);
  installation.dispose();
  assert.equal(documentEvents.listenerCount('astro:page-load'), 0);
  assert.equal(windowEvents.listenerCount('pageshow'), 0);
});

test('shared catalog revision is the SHA-256 of canonical public album data', () => {
  const digest = createHash('sha256').update(JSON.stringify(publicAlbums)).digest('hex');
  assert.equal(CATALOG_REVISION, 'sha256:' + digest);
});
