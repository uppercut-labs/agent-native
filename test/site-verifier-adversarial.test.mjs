import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { verifyProtocol, verifyPublication } from '../bin/verify-publication.mjs';
import { planPublication } from '../dist/publication.js';

async function fixture(t) {
  const source = {
    id: 'rate',
    revision: 'v1',
    visibility: 'public',
    route: '/rate',
    title: 'Rate',
    markdown: 'The rental fee is 19 euros & tax.',
  };
  let plan;
  const state = {
    requests: [],
    head: '<link rel="canonical" href="/guide/rate">',
    body: '<article>The rental fee is <b>19</b> euros &amp; tax.</article>',
    fallback: false,
    doc: {},
  };
  const server = createServer((req, res) => {
    state.requests.push(req.url);
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type });
      res.end(body);
    };
    const asset = plan.assets.find((a) => `/guide/${a.path}` === req.url);
    if (asset) return send(200, asset.mediaType, asset.content);
    if (req.url === '/guide/rate')
      return send(
        200,
        'text/html',
        `<!doctype html><html><head>${state.head}</head><body>${state.body}</body></html>`,
      );
    if (req.url === '/guide/openapi')
      return send(200, 'application/json', JSON.stringify(state.doc));
    if (state.fallback && req.url.startsWith('/guide/agent-native/'))
      return send(200, 'text/html', 'App shell');
    return send(404, 'text/plain', 'Missing');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const siteUrl = `http://127.0.0.1:${server.address().port}/guide/`;
  const config = {
    siteUrl,
    enabled: true,
    title: 'Equipment desk',
    description: 'Reviewed equipment rates.',
  };
  plan = await planPublication(config, [source]);
  return {
    state,
    siteUrl,
    verify: (probes = {}) => verifyPublication(plan, config, probes, [source]),
  };
}

test('canonical has an explicit href and served text carries the approved source fact', async (t) => {
  const { state, verify } = await fixture(t);
  assert.equal((await verify()).status, 'verified');
  for (const head of [
    '<link rel="canonical">',
    '<link rel="canonical" href="">',
    '<link data-x=\' rel="canonical" href="/guide/rate"\'>',
    '<link rel="canonical" href="/rate">',
  ]) {
    state.head = head;
    assert.equal((await verify()).checks.find((c) => c.test === 'human-page').pass, false, head);
  }
  state.head = '<link rel="canonical" href="/guide/rate">';
  state.body =
    '<article>The rental fee is 70 euros.</article><script>const hidden="The rental fee is 19 euros & tax."</script>';
  assert.equal((await verify()).status, 'failed');
  state.body = '<div id="app"></div><script src="/assets/application.js"></script>';
  assert.equal((await verify()).status, 'failed');
  state.head += '<link rel="alternate" type="text/markdown" href="/guide/agent-native/rate.md">';
  assert.equal((await verify()).status, 'verified');
  state.fallback = true;
  assert.equal((await verify()).checks.find((c) => c.test === 'missing-mirror').pass, false);
});

test('private probe inputs are rejected before requests and omitted from receipts', async (t) => {
  const { state, siteUrl, verify } = await fixture(t);
  for (const probe of [
    { path: `${siteUrl.replace('://', '://user:SECRET@')}oops`, status: 404 },
    { path: 'forgot?token=SECRET', status: 404 },
    { path: 'inside#SECRET', status: 404 },
    { path: '../guide/SECRET', status: 404 },
    { path: '/foreign/SECRET', status: 404 },
    { path: '%2e%2e/SECRET', status: 404 },
    { path: '%252fSECRET', status: 404 },
    { path: '%00SECRET', status: 404 },
    { path: '//evil.test/SECRET', status: 404 },
    { path: 'test', status: 200, contains: 'SECRET' },
    { path: 'test', status: 200, headers: { authorization: 'SECRET' } },
    { path: 'test', status: 999 },
    null,
  ]) {
    const result = await verify({ responses: [{ path: 'ok', status: 200 }, probe] });
    assert.deepEqual(result, { status: 'failed', code: 'invalid-probe', checks: [] });
  }
  assert.deepEqual(state.requests, []);
  const out = await verify({ responses: [{ path: 'sensitive-slug', status: 404 }] });
  assert.equal(out.status, 'verified');
  assert.doesNotMatch(JSON.stringify(out), /sensitive-slug/);
  assert.equal(out.checks.at(-1).probe, 1);
});

test('an OpenAPI advertisement requires a concrete operation and a documented response', async (t) => {
  const { state, siteUrl } = await fixture(t);
  const declare = { protocol: 'openapi', url: `${siteUrl}openapi` };
  for (const operation of [
    null,
    {},
    { get: null },
    { get: { responses: [] } },
    { get: { responses: { 200: null } } },
    { get: { responses: { oops: { description: 'OK' } } } },
  ]) {
    state.doc = {
      openapi: '3.1.0',
      info: { title: 'Desk', version: '1' },
      paths: { '/rates': operation },
    };
    assert.equal(await verifyProtocol(declare), false);
  }
  state.doc.paths['/rates'] = { get: { responses: { 200: { description: 'Public rates' } } } };
  assert.equal(await verifyProtocol(declare), true);
});
