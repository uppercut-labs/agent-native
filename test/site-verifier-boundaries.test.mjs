import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { verifyProtocol, verifyPublication } from '../bin/verify-publication.mjs';
import { planPublication } from '../dist/publication.js';

test('protocol probes reject HTML, authentication, missing resources and foreign redirects', async (t) => {
  let requests = [];
  const description = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Public events', version: '1' },
    paths: { '/events': { get: { responses: { 200: { description: 'Public list' } } } } },
  });
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
    });
    if (req.url === '/valid') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(description);
    } else if (req.url === '/fallback') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Application shell</body></html>');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: 'https://foreign.invalid/openapi' });
      res.end();
    } else {
      res.writeHead(req.url === '/account' ? 401 : 404, { 'content-type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const siteUrl = `http://127.0.0.1:${server.address().port}/`;
  const config = {
    enabled: true,
    siteUrl,
    title: 'Events',
    description: 'Public event information.',
  };
  assert.equal(await verifyProtocol({ protocol: 'openapi', url: `${siteUrl}valid` }), true);
  for (const route of ['fallback', 'redirect', 'account', 'missing']) {
    const declaration = { protocol: 'openapi', url: siteUrl + route, required: true };
    assert.equal(await verifyProtocol(declaration), false);
    const rejected = await planPublication({ ...config, protocols: [declaration] }, [], {
      verifyProtocol,
    });
    assert.equal(rejected.diagnostics[0].code, 'unverified-protocol');
    assert.deepEqual(rejected.assets, []);
  }
  const before = requests.length;
  const noProtocols = await planPublication(config, [], { verifyProtocol });
  assert.equal(requests.length, before);
  assert.deepEqual(noProtocols.diagnostics, []);
  assert.ok(
    requests.every(
      (request) => request.method === 'GET' && !request.cookie && !request.authorization,
    ),
  );
});

test('private marker controls reject browser payload and HTML leaks without echoing the marker', async (t) => {
  const marker = 'SYNTHETIC_PRIVATE_CONTROL_7c981e';
  const source = {
    id: 'event',
    revision: 'r1',
    route: '/event',
    visibility: 'public',
    title: 'Public event',
    markdown: 'Doors open at 10:30.',
  };
  let plan;
  let leak = false;
  const server = createServer((req, res) => {
    const asset = plan.assets.find((item) => `/${item.path}` === req.url);
    res.setHeader(
      'content-type',
      asset?.mediaType ?? (req.url === '/event' ? 'text/html' : 'text/javascript'),
    );
    if (asset) return res.end(asset.content);
    if (req.url === '/event')
      return res.end(
        `<!doctype html><html><head><link rel="canonical" href="/event"></head><body><h1>Public event</h1><p>Doors open at 10:30.</p>${leak ? `<script>${marker}</script>` : ''}</body></html>`,
      );
    if (req.url === '/assets/application.js')
      return res.end(
        leak ? `const leaked="${marker}";` : 'const publicControl="Doors open at 10:30.";',
      );
    res.statusCode = 404;
    res.end('Missing');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = {
    enabled: true,
    siteUrl: `http://127.0.0.1:${server.address().port}/`,
    title: 'Events',
    description: 'Public information.',
  };
  plan = await planPublication(config, [source]);
  const probes = {
    responses: [
      { path: '/event', status: 200, contains: ['Doors open at 10:30.'], excludes: [marker] },
      { path: '/assets/application.js', status: 200, excludes: [marker] },
    ],
  };
  const green = await verifyPublication(plan, config, probes, [source]);
  assert.equal(green.status, 'verified');
  leak = true;
  const red = await verifyPublication(plan, config, probes, [source]);
  assert.equal(red.status, 'failed');
  assert.deepEqual(
    red.checks
      .filter((check) => !check.pass)
      .map((check) => ({ test: check.test, probe: check.probe })),
    [
      { test: 'declared-response', probe: 1 },
      { test: 'declared-response', probe: 2 },
    ],
  );
  assert.doesNotMatch(JSON.stringify(red), new RegExp(marker));
});
