import assert from 'node:assert/strict';
import test from 'node:test';
import { albumLookup, lookupAlbum, registry } from '../src/catalog.mjs';

test('one shared contract and handler back the E02 server registry', () => {
  assert.equal(registry.definitions[0], albumLookup);
  assert.equal(registry.bindings.length, 1);
  assert.equal(lookupAlbum({ slug: 'after-the-rain' }).kind, 'found');
  assert.deepEqual(lookupAlbum({ slug: 'not-filed' }), { kind: 'missing' });
  assert.throws(() => albumLookup.input.parse({ slug: 'not valid' }));
});
