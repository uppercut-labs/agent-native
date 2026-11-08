import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptsMarkdown,
  addVary,
  markdownMirrors,
  markdownNegotiationHandler,
  negotiateMarkdown,
  planPublication,
} from '../dist/publication.js';

const site = {
  enabled: true,
  siteUrl: 'https://example.test/guide',
  title: 'Reference',
  description: 'Public schedules.',
  full: true,
};
const page = {
  id: 'quay',
  revision: 'r1',
  route: '/lines/river/stops/quay',
  visibility: 'public',
  title: 'Quay stop',
  markdown: 'River line trams call every 12 minutes at Quay.',
  facts: [
    { label: 'Transit line', value: 'River line' },
    { label: 'Tram interval', value: '12 minutes' },
  ],
};
const other = {
  id: 'pier',
  revision: 'r1',
  route: '/piers/two/',
  visibility: 'public',
  title: 'Pier Two',
  markdown: 'Pier Two serves the harbor crossing.',
};
const hidden = { id: 'staff', revision: 'r1', route: '/staff/note', visibility: 'private' };
const asset = (plan, path) => plan.assets.find((file) => file.path === path)?.content;
const errors = (plan) => plan.diagnostics.filter((item) => item.severity === 'error');

test('llms.txt states its coverage and links the aggregate only when it is published', async () => {
  const plan = await planPublication(site, [page, other, hidden]);
  assert.deepEqual(errors(plan), []);
  const index = asset(plan, 'llms.txt');
  const lines = index.split('\n');
  assert.equal(lines[0], '# Reference');
  assert.match(
    lines[4],
    /^This index lists every page this site publishes \(2 pages\)\. A fact that is not stated on these pages is not published by this site\. Private, draft, authenticated and personalized records are never published here\.$/,
  );
  assert.equal(
    lines[6],
    '- [All published pages in one file](https://example.test/guide/llms-full.txt)',
  );
  assert.ok(index.indexOf('llms-full.txt') < index.indexOf('## Pages'));
  assert.doesNotMatch(index, /staff/);

  const single = await planPublication({ ...site, full: false }, [page]);
  assert.match(asset(single, 'llms.txt'), /publishes \(1 page\)\./);
  assert.doesNotMatch(asset(single, 'llms.txt'), /llms-full/);
  assert.equal(asset(single, 'llms-full.txt'), undefined);

  const oversized = await planPublication({ ...site, maxFullBytes: 10 }, [page]);
  assert.deepEqual(
    errors(oversized).map((item) => item.code),
    ['aggregate-too-large'],
  );
  assert.deepEqual(oversized.assets, []);
});

test('mirrors name their own URL and list owner-declared key facts after the prose', async () => {
  const plan = await planPublication(site, [page, other]);
  const mirror = asset(plan, 'agent-native/lines/river/stops/quay.md');
  assert.equal(
    mirror,
    '# Quay stop\n\nCanonical: <https://example.test/guide/lines/river/stops/quay>\n' +
      'Markdown: <https://example.test/guide/agent-native/lines/river/stops/quay.md>\n\n' +
      'River line trams call every 12 minutes at Quay.\n\n## Key facts\n\n' +
      '- Transit line: River line\n- Tram interval: 12 minutes\n',
  );
  assert.doesNotMatch(asset(plan, 'agent-native/piers/two.md'), /Key facts/);
  assert.match(asset(plan, 'llms-full.txt'), /- Tram interval: 12 minutes/);

  const changed = await planPublication(site, [
    { ...page, facts: [{ label: 'Tram interval', value: '15 minutes' }] },
    other,
  ]);
  assert.notEqual(changed.digest, plan.digest);
});

test('invalid key facts block the projection', async () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ label: `Fact ${i}`, value: String(i) }));
  for (const facts of [
    'River line',
    [{ label: 'Line' }],
    [{ label: '', value: 'River line' }],
    [{ label: 'Line', value: 'River\nline' }],
    [{ label: 'Line', value: '<b>River</b>' }],
    [{ label: 'Line', value: '[River](https://elsewhere.test/)' }],
    many,
  ]) {
    const plan = await planPublication(site, [{ ...page, facts }]);
    assert.deepEqual(
      errors(plan).map((item) => item.code),
      ['invalid-projection'],
      JSON.stringify(facts).slice(0, 80),
    );
    assert.deepEqual(plan.assets, []);
  }
});

test('Accept negotiation prefers Markdown only when a client names it', () => {
  for (const accept of [
    'text/markdown',
    'text/html, text/markdown, text/plain, application/json',
    'text/markdown, text/html;q=0.9',
    'text/markdown;q=0.8, */*;q=0.5',
    'TEXT/MARKDOWN; charset=utf-8',
  ])
    assert.equal(acceptsMarkdown(accept), true, accept);
  for (const accept of [
    undefined,
    '',
    '*/*',
    'text/*',
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'text/markdown;q=0',
    'text/markdown;q=0.5, text/html',
    'text/markdown;q=0.5, text/*;q=0.9',
  ])
    assert.equal(acceptsMarkdown(accept), false, String(accept));
});

test('negotiation maps canonical routes to mirrors and always varies on Accept', async () => {
  const plan = await planPublication(site, [page, other]);
  const mirrors = markdownMirrors(plan.manifest.entries);
  assert.deepEqual(mirrors, {
    '/guide/lines/river/stops/quay': '/guide/agent-native/lines/river/stops/quay.md',
    '/guide/piers/two': '/guide/agent-native/piers/two.md',
  });
  const ask = (pathname, accept, method = 'GET') =>
    negotiateMarkdown({ method, pathname, accept }, mirrors);
  assert.deepEqual(ask('/guide/piers/two/', 'text/markdown'), {
    mirror: '/guide/agent-native/piers/two.md',
    vary: true,
  });
  assert.deepEqual(ask('/guide/piers/two', 'text/html'), { mirror: null, vary: true });
  assert.deepEqual(
    ask('/guide/piers/two', 'text/markdown', 'HEAD').mirror,
    '/guide/agent-native/piers/two.md',
  );
  assert.deepEqual(ask('/guide/piers/two', 'text/markdown', 'POST'), { mirror: null, vary: false });
  assert.deepEqual(ask('/guide/staff/note', 'text/markdown'), { mirror: null, vary: false });
  assert.deepEqual(ask('/guide/%E0%A4%A', 'text/markdown'), { mirror: null, vary: false });
  assert.deepEqual(ask('/guide/constructor', 'text/markdown'), { mirror: null, vary: false });
  assert.deepEqual(markdownMirrors([{ canonical: 'https://example.test/a', mirror: null }]), {});
  assert.equal(addVary(undefined), 'Accept');
  assert.equal(addVary('Accept-Encoding'), 'Accept-Encoding, Accept');
  assert.equal(addVary('RSC, accept'), 'RSC, accept');
  assert.equal(addVary(['Origin', 'Cookie']), 'Origin, Cookie, Accept');
  assert.equal(addVary('*'), '*');
});

test('the Node middleware serves the mirror or passes through with Vary', async () => {
  const mirrors = { '/piers/two': '/agent-native/piers/two.md' };
  const files = { '/agent-native/piers/two.md': '# Pier Two\n' };
  const handler = markdownNegotiationHandler(mirrors, async (path) => files[path] ?? null);
  const call = (url, accept, method = 'GET') =>
    new Promise((resolve) => {
      const headers = {};
      const res = {
        statusCode: 0,
        setHeader: (name, value) => {
          headers[name.toLowerCase()] = value;
        },
        getHeader: (name) => headers[name.toLowerCase()],
        end: (body) => resolve({ passed: false, status: res.statusCode, headers, body }),
      };
      handler({ method, url, headers: { accept } }, res, () => resolve({ passed: true, headers }));
    });
  const markdown = await call('/piers/two?x=1', 'text/markdown');
  assert.deepEqual(markdown, {
    passed: false,
    status: 200,
    headers: { vary: 'Accept', 'content-type': 'text/markdown; charset=utf-8' },
    body: '# Pier Two\n',
  });
  assert.equal((await call('/piers/two', 'text/markdown', 'HEAD')).body, undefined);
  assert.deepEqual(await call('/piers/two', 'text/html'), {
    passed: true,
    headers: { vary: 'Accept' },
  });
  assert.deepEqual(await call('/elsewhere', 'text/markdown'), { passed: true, headers: {} });
  const missing = markdownNegotiationHandler(mirrors, async () => null);
  await new Promise((resolve) =>
    missing(
      { method: 'GET', url: '/piers/two', headers: { accept: 'text/markdown' } },
      { statusCode: 0, setHeader() {}, getHeader() {}, end: () => assert.fail('served') },
      resolve,
    ),
  );
});
