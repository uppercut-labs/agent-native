import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnoseSidecar } from '../src/diagnostics.mjs';
const x = {
  pageOrigin: 'https://catalog.example.test',
  sidecarOrigin: 'https://api.example.test',
  browserRevision: 'sha256:9748f47e7e0eca26acd3e5b0fe30c6227242ea7abeb4f62beab76b68b064d7c6',
};
test('separate origin', () =>
  assert.equal(
    diagnoseSidecar({ ...x, sidecarHealth: { status: 'ok', catalogRevision: x.browserRevision } })
      .kind,
    'sidecar-origin-differs',
  ));
test('missing same-origin route', () =>
  assert.equal(
    diagnoseSidecar({
      ...x,
      sameOriginMcpStatus: 404,
      expectedRouteMode: 'same-origin',
      sidecarHealth: { status: 'ok', catalogRevision: x.browserRevision },
    }).kind,
    'same-origin-route-missing',
  ));
test('missing binding', () =>
  assert.equal(
    diagnoseSidecar({
      ...x,
      sidecarHealth: { status: 'unavailable', code: 'missing_catalog_binding' },
    }).kind,
    'missing-catalog-binding',
  ));
test('revision mismatch', () =>
  assert.equal(
    diagnoseSidecar({ ...x, sidecarHealth: { status: 'ok', catalogRevision: 'other' } }).kind,
    'catalog-revision-mismatch',
  ));

test('direct sidecar mode keeps an absent same-origin route as informational', () =>
  assert.equal(
    diagnoseSidecar({
      ...x,
      sameOriginMcpStatus: 404,
      expectedRouteMode: 'sidecar',
      sidecarHealth: { status: 'ok', catalogRevision: x.browserRevision },
    }).kind,
    'sidecar-origin-differs',
  ));
