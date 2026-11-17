import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationRegistry, presentationValue } from '../dist/ui-presentation.js';
const p = {
  capabilityId: 'demo:lookup@1',
  catalogId: 'urn:demo:1',
  resourceUri: 'ui://demo/view.html',
  name: 'Demo',
};
test('presentation binds only known capability identities', () => {
  assert.throws(() => new PresentationRegistry([], [p]));
  const registry = new PresentationRegistry([p.capabilityId], [p]);
  assert.equal(registry.get(p.capabilityId).name, 'Demo');
  assert.equal(registry.get('demo:other@1'), undefined);
});
test('presentation rejects duplicate, traversal and oversized resources', () => {
  assert.throws(() => new PresentationRegistry([p.capabilityId], [p, p]));
  assert.throws(
    () => new PresentationRegistry([p.capabilityId], [{ ...p, resourceUri: 'ui://demo/../oops' }]),
  );
  const registry = new PresentationRegistry([p.capabilityId], [p]);
  assert.throws(() => registry.resources(() => 'x'.repeat(1048577)));
});
test('resource descriptors match existing MCP Apps adapter shape', () => {
  const registry = new PresentationRegistry([p.capabilityId], [p]);
  assert.deepEqual(
    registry.resources(() => '<p>View</p>'),
    [{ capabilityId: p.capabilityId, uri: p.resourceUri, name: 'Demo', html: '<p>View</p>' }],
  );
});
test('canonical presentation value is not double-wrapped as MCP output', () => {
  assert.deepEqual(presentationValue('Ready', { count: 1 }, []), {
    summary: 'Ready',
    data: { count: 1 },
    a2ui: [],
  });
  assert.throws(() => presentationValue('', null, []));
});
