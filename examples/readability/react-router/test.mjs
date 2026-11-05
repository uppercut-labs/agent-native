// Run against the production server started by npm start.
import assert from 'node:assert/strict';
import test from 'node:test';
const base = new URL(process.env.SITE_URL ?? 'http://127.0.0.1:4173');
const path = '/lines/river/stops/quay';
const fact = `every ${process.env.STOP_INTERVAL ?? '12'} minutes`;
test('moved stop resolves to an approved canonical and missing stops use an error boundary', async () => {
  const [moved, html, markdown, missing, restricted] = await Promise.all([
    fetch(new URL('/lines/river/stops/old-wharf', base), { redirect: 'manual' }),
    fetch(new URL(path, base)),
    fetch(new URL(`/agent-native${path}.md`, base)),
    fetch(new URL('/lines/river/stops/missing', base)),
    fetch(new URL('/account/settings', base)),
  ]);
  assert.equal(moved.status, 301);
  assert.equal(new URL(moved.headers.get('location'), base).pathname, path);
  assert.equal(html.status, 200);
  const human = await html.text();
  assert.ok(human.includes(fact));
  assert.ok(human.includes('Save stop'));
  assert.equal(markdown.status, 200);
  const mirror = await markdown.text();
  assert.ok(mirror.includes(fact));
  assert.ok(mirror.includes(new URL(path, base).href));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /<h1>404<\/h1>/);
  assert.equal(restricted.status, 403);
});

test('private synthetic control appears only on the separately authorized endpoint', async () => {
  const index = await fetch(new URL('/llms-full.txt', base));
  assert.equal(index.status, 200);
  assert.ok(!(await index.text()).includes('PRIVATE-TRANSIT-7E93'));
  if (process.env.FIXTURE_STAFF_TOKEN) {
    const response = await fetch(new URL('/account/settings', base), {
      headers: { authorization: `Bearer ${process.env.FIXTURE_STAFF_TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('PRIVATE-TRANSIT-7E93'));
  }
});
