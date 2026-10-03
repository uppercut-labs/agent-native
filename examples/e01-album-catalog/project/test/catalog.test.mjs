import { httpInvocationPath } from '@uppercut-labs/agent-native/http';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumHttpHandler, getAlbumCapability, runAlbumLookup } from '../src/catalog.mjs';

test('returns found and missing album outcomes through the local executor', async () => {
  const found = await runAlbumLookup({ slug: 'first-light' });
  const missing = await runAlbumLookup({ slug: 'not-in-catalog' });

  assert.equal(found.kind, 'success');
  if (found.kind === 'success') {
    assert.deepEqual(found.value, {
      kind: 'found',
      album: { slug: 'first-light', title: 'First Light' },
    });
  }
  assert.equal(missing.kind, 'success');
  if (missing.kind === 'success') {
    assert.deepEqual(missing.value, { kind: 'missing' });
  }
});

test('rejects malformed slugs before authorization or handler execution', async () => {
  const result = await runAlbumLookup({ slug: 'First Light' });

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.reason, 'invalid-input');
    assert.equal(result.observation.checkId, 'UAN-002.invalid-input');
  }
});

test('serves the same album contract through the HTTP adapter', async () => {
  const url = new URL(httpInvocationPath(getAlbumCapability.identity), 'http://localhost').href;
  const found = await albumHttpHandler(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'first-light' }),
    }),
  );
  const missing = await albumHttpHandler(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'not-in-catalog' }),
    }),
  );

  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), {
    kind: 'found',
    album: { slug: 'first-light', title: 'First Light' },
  });
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { kind: 'missing' });
});
