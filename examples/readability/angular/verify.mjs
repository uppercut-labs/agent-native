import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { makeServer } from './serve.mjs';

const site = new URL(process.env.SITE_URL || 'http://127.0.0.1:4173');
const marker = 'SERVICE-ONLY-CALIBRATION-6914';
test('native prerender, approved mirrors, private routes and hydrated model checklist', async (t) => {
  const server = makeServer();
  server.listen(Number(site.port), site.hostname);
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const model = JSON.parse(
    await readFile(new URL('./generated/publication.json', import.meta.url)),
  );
  const original = process.env.READABILITY_EDITION === 'original';
  const oldStatus = original ? 200 : 404;
  for (const route of [
    '/guides/retired',
    '/agent-native/guides/retired.md',
    '/agent-native/guides/retired.jsonld',
  ]) {
    assert.equal((await fetch(new URL(route, site))).status, oldStatus, route);
  }
  const aggregate = await (await fetch(new URL('/llms-full.txt', site))).text();
  assert.match(aggregate, original ? /Pier Four/ : /Pier Seven/);
  assert.equal(aggregate.includes('dry dock'), original);
  const equipment = model.pages.find((p) => p.id === 'atlas-7');
  const index = await (await fetch(new URL('/llms.txt', site))).text();
  assert.ok(index.includes(equipment.mirror) || index.includes(equipment.canonical));
  const mirror = await fetch(equipment.mirror);
  assert.match(mirror.headers.get('content-type'), /^text\/markdown/);
  assert.match(await mirror.text(), /18 Nm/);
  const direct = await fetch(equipment.canonical);
  assert.equal(direct.status, 200);
  const html = await direct.text();
  assert.match(html, /<h1[^>]*>Atlas 7 operator handbook<\/h1>/);
  assert.match(html, /18 Nm/);
  assert.match(html, /ngh=/);
  assert.ok(html.includes(equipment.canonical));
  const schema = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
  assert.equal(JSON.parse(schema[1]).url, equipment.canonical);
  for (const [route, status] of [
    ['/service/atlas-7', 403],
    ['/account/settings', 403],
    ['/equipment/missing', 404],
    ['/agent-native/missing.md', 404],
  ]) {
    assert.equal((await fetch(new URL(route, site))).status, status, route);
  }
  const root = new URL('./dist/browser/', import.meta.url);
  for (const file of await readdir(root, { recursive: true })) {
    if (/\.(?:html|json|jsonld|txt|md|js)$/.test(file)) {
      assert.ok(!(await readFile(new URL(file, root), 'utf8')).includes(marker), file);
    }
  }
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(equipment.canonical);
  const chunks = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.endsWith('.js')) chunks.push(r.url());
  });
  await page.getByRole('button', { name: 'Start checklist' }).click();
  await page.getByLabel('Torque collar inspected').check();
  await expect(page.getByRole('status')).toHaveText('Inspection complete');
  assert.ok(chunks.length > 0, 'checklist fetched on demand');
  await page.getByRole('link', { name: 'Field guide' }).click();
  await page.getByRole('link', { name: 'Meridian crossing' }).click();
  await expect(page.locator('main')).toContainText(/Pier (Seven|Four)/);
  assert.deepEqual(errors, []);
});
