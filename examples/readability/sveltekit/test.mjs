// Run against the production server started by npm start.
import assert from 'node:assert/strict';
import test from 'node:test';
const base = new URL(process.env.SITE_URL ?? 'http://127.0.0.1:4173');
const path = '/events/lanterns';
const markdown = '/agent-native/events/lanterns.md';
const fact = `Doors open at ${process.env.WORKSHOP_OPENS ?? '10:30'}.`;
test('public workshop stays readable without a session and across cookie variants', async () => {
  const [html, anon, signed, restricted, missing] = await Promise.all([
    fetch(new URL(path, base)),
    fetch(new URL(markdown, base)),
    fetch(new URL(markdown, base), { headers: { cookie: 'session=test-session' } }),
    fetch(new URL(`${path}/attendees`, base)),
    fetch(new URL('/events/unknown', base)),
  ]);
  assert.equal(html.status, 200);
  const human = await html.text();
  assert.ok(human.includes(fact));
  assert.ok(human.includes('Save workshop'));
  assert.equal(anon.status, 200);
  assert.equal(signed.status, 200);
  const body = await anon.text();
  assert.ok(body.includes(fact));
  assert.equal(body, await signed.text());
  assert.equal(restricted.status, 403);
  assert.match(restricted.headers.get('cache-control'), /no-store/);
  assert.equal(missing.status, 404);
});

test('private synthetic control appears only on the separately authorized endpoint', async () => {
  const index = await fetch(new URL('/llms-full.txt', base));
  assert.equal(index.status, 200);
  assert.ok(!(await index.text()).includes('PRIVATE-ATTENDEE-6C72'));
  if (process.env.FIXTURE_ATTENDEE_TOKEN) {
    const response = await fetch(new URL('/events/lanterns/attendees', base), {
      headers: { authorization: `Bearer ${process.env.FIXTURE_ATTENDEE_TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('PRIVATE-ATTENDEE-6C72'));
  }
});
