import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { createBrowserCapabilityAdapter } from '../dist/browser.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';

class SimulatedModelContext {
  tools = new Map();
  registrations = 0;
  delay = 0;
  async registerTool(tool, { signal } = {}) {
    this.registrations += 1;
    if (signal?.aborted) throw signal.reason;
    if (this.delay > 0) await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (signal?.aborted) throw signal.reason;
    if (this.tools.has(tool.name)) throw new Error('duplicate WebMCP tool');
    this.tools.set(tool.name, tool);
    signal?.addEventListener('abort', () => this.tools.delete(tool.name), { once: true });
  }
}

function fakeDocument(supported = true) {
  const listeners = new Map();
  const lifecycle = {
    addEventListener(type, listener) {
      const callbacks = listeners.get(type) ?? new Set();
      callbacks.add(listener);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
  };
  return {
    modelContext: supported ? new SimulatedModelContext() : undefined,
    defaultView: lifecycle,
    lifecycle,
  };
}

function fixtureRegistry(target = 'browser', delayMs = 0) {
  let calls = 0;
  let started = 0;
  const publicDefinition = defineCapability({
    identity: { namespace: 'example.browser', name: 'theme.get', majorVersion: 1 },
    description: 'Read the current page theme.',
    input: fromZod(z.object({})),
    output: fromZod(z.object({ theme: z.enum(['light', 'dark']) })),
    risk: 'read',
    access: { kind: 'public' },
  });
  const protectedDefinition = defineCapability({
    identity: { namespace: 'example.browser', name: 'theme.set', majorVersion: 1 },
    description: 'Set the current page theme.',
    input: fromZod(z.object({ theme: z.enum(['light', 'dark']) })),
    output: fromZod(z.object({ theme: z.enum(['light', 'dark']) })),
    risk: 'write',
    access: { kind: 'protected', scopes: ['theme:change'] },
  });
  const publicBinding = bindCapability(publicDefinition, {
    id: 'read-theme',
    targets: [target],
    execute: async () => ({ theme: 'light' }),
  });
  const protectedBinding = bindCapability(protectedDefinition, {
    id: 'write-theme',
    targets: [target],
    execute: async ({ theme }, { signal }) => {
      started += 1;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!signal.aborted) calls += 1;
      return { theme };
    },
  });
  return {
    registry: createCapabilityRegistry(
      [publicDefinition, protectedDefinition],
      [publicBinding, protectedBinding],
    ),
    calls: () => calls,
    started: () => started,
  };
}

test('SIMULATED WebMCP API registers and invokes browser bindings through the executor', async () => {
  const doc = fakeDocument();
  const fixture = fixtureRegistry();
  const adapter = createBrowserCapabilityAdapter(doc);
  const report = await adapter.sync(fixture.registry);
  assert.equal(adapter.supported, true);
  assert.equal(report.supported, true);
  assert.equal(report.registered.length, 1);
  assert.ok(report.skipped.some((item) => item.reason === 'policy-denied'));
  const tool = doc.modelContext.tools.get(report.registered[0]);
  assert.ok(tool);
  const result = await tool.execute({ theme: 'dark' }, { signal: new AbortController().signal });
  assert.deepEqual(result, {
    ok: true,
    capabilityId: 'example.browser:theme.get@1',
    value: { theme: 'light' },
  });
  assert.equal(fixture.calls(), 0);
  adapter.dispose();
});

test('SIMULATED API repeats initialization safely and removes opted-in protected tools on logout', async () => {
  const doc = fakeDocument();
  const fixture = fixtureRegistry();
  const adapter = createBrowserCapabilityAdapter(doc);
  assert.equal(createBrowserCapabilityAdapter(doc), adapter);
  let authorized = true;
  const loggedIn = {
    canExpose: () => true,
    resolveExecutionContext: () => ({
      caller: { kind: 'authenticated', subject: 'page-user', scopes: ['theme:change'] },
      authorization: { authorize: () => authorized },
    }),
  };
  const first = await adapter.sync(fixture.registry, loggedIn);
  assert.equal(first.registered.length, 2);
  const repeated = await adapter.sync(fixture.registry, loggedIn);
  assert.equal(repeated.registered.length, 2);
  assert.equal(doc.modelContext.tools.size, 2);

  const protectedName = repeated.registered.find((name) => name.includes('theme.set'));
  assert.ok(protectedName);
  const result = await doc.modelContext.tools
    .get(protectedName)
    .execute({ theme: 'dark' }, { signal: new AbortController().signal });
  assert.deepEqual(result, {
    ok: true,
    capabilityId: 'example.browser:theme.set@1',
    value: { theme: 'dark' },
  });
  assert.equal(fixture.calls(), 1);
  authorized = false;
  const denied = await doc.modelContext.tools
    .get(protectedName)
    .execute({ theme: 'light' }, { signal: new AbortController().signal });
  assert.deepEqual(denied, { ok: false, error: 'Capability is not authorized.' });
  assert.equal(fixture.calls(), 1);

  const capturedCallback = doc.modelContext.tools.get(protectedName).execute;
  const loggedOut = await adapter.sync(fixture.registry, {
    canExpose: () => false,
    resolveExecutionContext: () => ({
      caller: { kind: 'anonymous' },
      authorization: { authorize: () => false },
    }),
  });
  assert.equal(loggedOut.registered.length, 0);
  assert.equal(doc.modelContext.tools.size, 0);
  const afterLogout = await capturedCallback(
    { theme: 'light' },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(afterLogout, { ok: false, error: 'Capability execution was cancelled.' });
  assert.equal(fixture.calls(), 1);
  adapter.dispose();
});

test('SIMULATED logout aborts an in-flight protected handler before its side effect', async () => {
  const doc = fakeDocument();
  const fixture = fixtureRegistry('browser', 30);
  const adapter = createBrowserCapabilityAdapter(doc);
  const options = {
    canExpose: () => true,
    resolveExecutionContext: () => ({
      caller: { kind: 'authenticated', subject: 'page-user', scopes: ['theme:change'] },
      authorization: { authorize: () => true },
    }),
  };
  const registered = await adapter.sync(fixture.registry, options);
  const protectedName = registered.registered.find((name) => name.includes('theme.set'));
  assert.ok(protectedName);
  const callback = doc.modelContext.tools.get(protectedName).execute;
  const running = callback({ theme: 'dark' }, { signal: new AbortController().signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.started(), 1);

  await adapter.sync(fixture.registry, { canExpose: () => false });
  const result = await running;
  assert.deepEqual(result, { ok: false, error: 'Capability execution was cancelled.' });
  assert.equal(fixture.calls(), 0);
  adapter.dispose();
});

test('SIMULATED rapid resync aborts pending registration and reports only current tools', async () => {
  const doc = fakeDocument();
  doc.modelContext.delay = 20;
  const adapter = createBrowserCapabilityAdapter(doc);
  const registry = fixtureRegistry().registry;
  const oldSync = adapter.sync(registry);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const currentSync = adapter.sync(registry);
  const [oldReport, currentReport] = await Promise.all([oldSync, currentSync]);
  assert.deepEqual(oldReport.registered, []);
  assert.equal(currentReport.registered.length, 1);
  assert.equal(doc.modelContext.tools.size, 1);
  adapter.dispose();
});

test('SIMULATED API removes tools on pagehide and tolerates unsupported browsers', async () => {
  const doc = fakeDocument();
  const adapter = createBrowserCapabilityAdapter(doc);
  const report = await adapter.sync(fixtureRegistry().registry);
  assert.equal(report.registered.length, 1);
  doc.defaultView.dispatch('pagehide');
  assert.equal(doc.modelContext.tools.size, 0);

  const serverOnlyDocument = fakeDocument();
  const serverOnly = fixtureRegistry('server');
  const serverOnlyAdapter = createBrowserCapabilityAdapter(serverOnlyDocument);
  const serverOnlyReport = await serverOnlyAdapter.sync(serverOnly.registry, {
    canExpose: () => true,
  });
  assert.equal(serverOnlyReport.registered.length, 0);
  assert.ok(serverOnlyReport.skipped.every((item) => item.reason === 'no-browser-binding'));
  assert.equal(serverOnlyDocument.modelContext.tools.size, 0);
  serverOnlyAdapter.dispose();

  const unsupported = createBrowserCapabilityAdapter(fakeDocument(false));
  const unsupportedReport = await unsupported.sync(fixtureRegistry().registry);
  assert.equal(unsupported.supported, false);
  assert.equal(unsupportedReport.supported, false);
  assert.deepEqual(unsupportedReport.registered, []);
  unsupported.dispose();
});

test('browser entry import graph excludes server adapters, MCP SDKs and secret fixtures', async () => {
  const dist = path.resolve('dist');
  const queue = [path.join(dist, 'browser.js')];
  const visited = new Set();
  const sources = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    sources.push(source);
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.ok(specifier);
      assert.equal(specifier.startsWith('node:'), false);
      assert.equal(specifier.includes('@modelcontextprotocol'), false);
      if (specifier.startsWith('.')) {
        const dependency = path.resolve(path.dirname(file), specifier);
        assert.ok(dependency.startsWith(dist + path.sep));
        assert.equal(dependency.includes('/mcp.'), false);
        assert.equal(dependency.includes('/http.'), false);
        queue.push(dependency);
      }
    }
  }
  assert.equal(sources.join('\n').includes('SERVER_ONLY_SECRET_SENTINEL'), false);
});
