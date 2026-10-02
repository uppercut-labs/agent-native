import assert from 'node:assert/strict';
import { test } from 'node:test';
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
