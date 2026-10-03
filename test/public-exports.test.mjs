import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as core from '../dist/index.js';
import * as registry from '@uppercut-labs/agent-native/registry';

test('public registry subpath exposes registration APIs but no direct handler invocation', () => {
  assert.deepEqual(Object.keys(registry).sort(), [
    'CapabilityRegistryError',
    'bindCapability',
    'createCapabilityRegistry',
  ]);
  assert.equal('invokeBindingHandler' in registry, false);
  assert.equal('invokeRegisteredBinding' in registry, false);
});

test('package exports block direct imports of the internal binding invoker', async () => {
  await assert.rejects(import('@uppercut-labs/agent-native/dist/core/binding-internal.js'), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });
});

test('MCP Apps remains an optional isolated package surface', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.exports['./mcp-apps'].import, './dist/mcp-apps.js');
  assert.equal(manifest.peerDependenciesMeta['@modelcontextprotocol/ext-apps'].optional, true);
  assert.equal('createMcpAppsHandler' in core, false);
});
