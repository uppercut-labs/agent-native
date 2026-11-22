import assert from 'node:assert/strict';
import test from 'node:test';
import { digestText, planPublication, safePublicationPath } from '../dist/publication.js';

const site = {
  enabled: true,
  siteUrl: 'https://example.test/guide',
  title: 'Reference',
  description: 'Public schedules and exhibits.',
  full: true,
};
const page = {
  id: 'event-1',
  revision: 'r1',
  route: '/events/open',
  visibility: 'public',
  title: 'Arts & hours',
  markdown: '## Visiting\r\n\r\nDoors open at eight.',
  locale: 'en-GB',
  structuredType: 'Article',
  category: 'Events',
  links: ['second'],
};
const second = {
  id: 'second',
  revision: 'r1',
  route: '/fr/été/',
  visibility: 'public',
  title: 'Été',
  markdown: 'Summer sessions start in June.',
  locale: 'fr',
};
const asset = (plan, path) => plan.assets.find((file) => file.path === path)?.content;
const problems = (plan) => plan.diagnostics.filter((item) => item.severity === 'error');
const allBytes = (plan) => plan.assets.map((file) => file.content).join('\n');

test('deterministic scoped outputs contain only approved public projections', async () => {
  const hidden = ['private', 'draft', 'personalized', 'authenticated', 'unknown'].map(
    (visibility, index) => ({
      id: `s-${index}`,
      revision: 'private-rev',
      route: `/restricted-SENTINEL-${index}`,
      visibility,
      title: 'SECRET-TITLE',
      markdown: 'SECRET-BODY',
      structuredType: 'WebPage',
    }),
  );
  const unselected = { ...page, id: 's-6', route: '/TEAM/roster', title: 'EXCLUDED-FIELD' };
  const inputs = [{ ...page, serverOnly: 'UNSELECTED-SCHEMA' }, second, unselected, ...hidden];
  const config = { ...site, excludedRoutes: ['/team'] };
  const result = await planPublication(config, inputs);
  assert.deepEqual(problems(result), []);
  assert.deepEqual(result, await planPublication(config, [...inputs].reverse()));
  for (const file of result.assets) assert.equal(file.digest, await digestText(file.content));
  assert.doesNotMatch(
    JSON.stringify(result),
    /SECRET-|restricted-SENTINEL|UNSELECTED-SCHEMA|EXCLUDED-FIELD|\/TEAM\/roster/,
  );
  assert.match(allBytes(result), /Doors open at eight/);
  assert.equal(result.manifest.entries.filter((e) => e.status === 'included').length, 2);
  assert.equal(result.manifest.entries.filter((e) => e.status === 'excluded').length, 6);
  const mirror = asset(result, 'agent-native/events/open.md');
  assert.match(mirror, /Canonical: <https:\/\/example\.test\/guide\/events\/open>/);
  assert.match(mirror, /\[Été\]\(https:\/\/example\.test\/guide\/fr\/%C3%A9t%C3%A9\/\)/);
  assert.match(mirror, /Language: en-GB/);
  assert.match(asset(result, 'llms.txt'), /## Events/);
  assert.match(asset(result, 'llms-full.txt'), /Summer sessions/);
  const json = asset(result, 'agent-native/events/open.jsonld');
  assert.ok(json.includes('Arts \\u0026 hours'));
  assert.deepEqual(JSON.parse(json), {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': 'https://example.test/guide/events/open',
    url: 'https://example.test/guide/events/open',
    headline: 'Arts & hours',
    inLanguage: 'en-GB',
  });
  assert.equal(asset(result, 'agent-native/fr/été.jsonld'), undefined);
});

test('withdrawal removes retired mirrors, links and aggregate text', async () => {
  const previous = await planPublication(site, [page, second]);
  const revised = await planPublication({ ...site, full: false }, [
    page,
    { ...second, visibility: 'private' },
  ]);
  assert.deepEqual(problems(revised), []);
  assert.notEqual(revised.digest, previous.digest);
  assert.equal(revised.diagnostics[0].code, 'excluded-link');
  assert.doesNotMatch(allBytes(revised), /Summer sessions|Été|%C3%A9t%C3%A9/);
  assert.deepEqual(
    previous.assets
      .filter((a) => !revised.assets.some((b) => b.path === a.path))
      .map((a) => a.path),
    ['agent-native/fr/été.md', 'llms-full.txt'],
  );
  assert.deepEqual((await planPublication({ ...site, enabled: false }, [page, second])).assets, []);
});

test('identity changes for revisions, projections, destinations, policy and new routes', async () => {
  const baseline = await planPublication(site, [page]);
  for (const [config, items] of [
    [site, [{ ...page, revision: 'r2' }]],
    [site, [{ ...page, markdown: 'Doors open at nine.' }]],
    [site, [{ ...page, links: ['other-unavailable'] }]],
    [site, [page, second]],
    [{ ...site, siteUrl: 'https://other.test' }, [page]],
    [{ ...site, excludedRoutes: ['/team'] }, [page]],
    [{ ...site, maxFullBytes: 2_000_000 }, [page]],
  ]) {
    const changed = await planPublication(config, items);
    assert.deepEqual(problems(changed), []);
    assert.notEqual(changed.digest, baseline.digest);
  }
});

test('collisions, reserved paths and unsafe configuration block the full output set', async () => {
  const caseWith = (route) => ({ ...second, route });
  const pairs = [
    [[page, caseWith('/Events/open/')], 'route-collision'],
    [[page, { ...second, id: page.id }], 'invalid-source'],
    [[{ ...page, route: '/' }, caseWith('/index')], 'output-collision'],
    [[{ ...page, route: '/docs' }, caseWith('/docs.md/intro')], 'output-collision'],
    [[caseWith('/agent-native/intro')], 'reserved-route'],
    [[caseWith('/LLMS.txt')], 'reserved-route'],
    [[caseWith('/%2e%2e/admin')], 'unsafe-route'],
    [[caseWith('/[slug]')], 'unsafe-route'],
    [[caseWith('//bad.test/x')], 'unsafe-route'],
    [[caseWith('/a/../b')], 'unsafe-route'],
    [[{ ...page, markdown: 'Read [the member list](/account/members)' }], 'unreviewed-markup'],
    [[{ ...page, markdown: '<script>alert(1)</script>' }], 'unreviewed-markup'],
    [[{ ...page, locale: 'en\nprivate' }], 'invalid-projection'],
  ];
  for (const [items, code] of pairs) {
    const result = await planPublication(site, items);
    assert.ok(
      problems(result).some((item) => item.code === code),
      code,
    );
    assert.deepEqual(result.assets, []);
  }
  for (const siteUrl of [
    'file:///public',
    'https://u:p@example.test',
    'https://example.test/a/../b',
    'https://example.test/base?query',
  ]) {
    const result = await planPublication({ ...site, siteUrl }, [page]);
    assert.equal(problems(result)[0].code, 'invalid-config');
  }
  const tooLarge = await planPublication({ ...site, maxFullBytes: 32 }, [page]);
  assert.equal(problems(tooLarge)[0].code, 'aggregate-too-large');
  assert.deepEqual(tooLarge.assets, []);
  for (const path of [
    '../escape',
    'con.txt',
    'COM¹.tXt',
    'NUL',
    'a/b.',
    'x\\tmp',
    'a//b',
    'a%2Fb',
    'C:/foo',
    'a/.secret',
  ]) {
    assert.equal(safePublicationPath(path), false, path);
  }
});

test('only live verified same-site public protocol declarations enter the index', async () => {
  const url = (tail) => `https://example.test/guide/${tail}`;
  const protocols = [
    { protocol: 'MCP', url: url('.well-known/service') },
    { protocol: 'Missing', url: url('not-present'), verified: true },
    { protocol: 'Foreign', url: 'https://other.test/api' },
    { protocol: 'Outside', url: 'https://example.test/guide-other/api' },
    { protocol: 'Restricted', url: url('restricted/api') },
    { protocol: 'Excluded', url: url('scratch/api') },
    { protocol: 'Personal', url: 'https://u:p@example.test/guide/credentials' },
  ];
  const actual = [];
  const verifier = {
    verifyProtocol: async (p) => {
      actual.push(p.url);
      return p.protocol === 'MCP';
    },
  };
  const config = { ...site, protocols, excludedRoutes: ['/scratch'] };
  const source = [page, { ...second, route: '/restricted', visibility: 'private' }];
  const plan = await planPublication(config, source, verifier);
  assert.deepEqual(problems(plan), []);
  assert.deepEqual(actual, [url('.well-known/service'), url('not-present')]);
  assert.match(asset(plan, 'llms.txt'), /\[MCP\]/);
  assert.doesNotMatch(
    allBytes(plan),
    /other\.test|not-present|scratch\/api|restricted\/api|credentials/,
  );
  const offline = await planPublication(config, source);
  assert.doesNotMatch(allBytes(offline), /well-known/);
  const required = await planPublication(
    { ...site, protocols: [{ ...protocols[0], required: true }] },
    source,
  );
  assert.equal(problems(required)[0].code, 'unverified-protocol');
  assert.deepEqual(required.assets, []);
});
