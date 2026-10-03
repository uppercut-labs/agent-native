import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNextBrowserBootstrap } from '../dist/next-browser.js';
import { createNextHttpRoute, createNextMcpRoute } from '../dist/next.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';

const schema = {
  parse(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new TypeError('object required');
    return value;
  },
  toJSONSchema() {
    return { type: 'object' };
  },
};

function registry(target) {
  const definition = defineCapability({
    identity: { namespace: 'next', name: 'probe', majorVersion: 1 },
    description: 'Probe the Next adapter.',
    input: schema,
    output: schema,
    risk: 'read',
    access: { kind: 'public' },
  });
  const binding = bindCapability(definition, {
    id: `next-${target}`,
    targets: [target],
    execute: (input) => input,
  });
  return createCapabilityRegistry([definition], [binding]);
}

test('Next server routes expose method-compatible Web handlers', async () => {
  const serverRegistry = registry('server');
  const http = createNextHttpRoute(serverRegistry);
  const mcp = createNextMcpRoute(serverRegistry);
  assert.equal(http.GET, http.POST);
  assert.equal(mcp.GET, mcp.POST);
  assert.equal(mcp.POST, mcp.DELETE);
  assert.equal((await http.GET(new Request('http://localhost/unknown'))).status, 404);
  assert.equal((await mcp.POST(new Request('http://localhost/elsewhere'))).status, 404);
});

test('Next browser bootstrap resync aborts stale registrations after navigation', async () => {
  const registrations = [];
  const listeners = new Map();
  const document = {
    defaultView: {
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      removeEventListener(name) {
        listeners.delete(name);
      },
    },
    modelContext: {
      async registerTool(tool, options) {
        registrations.push({ tool, signal: options.signal });
      },
    },
  };
  const bootstrap = createNextBrowserBootstrap(document, registry('browser'));
  assert.equal(bootstrap.supported, true);
  assert.equal((await bootstrap.sync()).registered.length, 1);
  assert.equal((await bootstrap.sync()).registered.length, 1);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].signal.aborted, true);
  assert.equal(registrations[1].signal.aborted, false);
  bootstrap.dispose();
  assert.equal(registrations[1].signal.aborted, true);
});
