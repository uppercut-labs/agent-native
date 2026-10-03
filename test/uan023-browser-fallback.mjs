import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../examples/e01-album-catalog/.exported/dist',
);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const relative = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const filename = path.resolve(root, '.' + relative);
  if (!filename.startsWith(root + path.sep)) {
    response.writeHead(400).end();
    return;
  }
  try {
    const data = await readFile(filename);
    response
      .writeHead(200, {
        'content-type': mime[path.extname(filename)] ?? 'application/octet-stream',
      })
      .end(data);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address === 'object');
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + address.port;
  await page.goto(origin + '/albums/', { waitUntil: 'networkidle' });
  const nativeWebMcp = await page.evaluate(() => typeof document.modelContext);
  assert.equal(nativeWebMcp, 'undefined');
  await page
    .locator('[data-agent-status]')
    .filter({ hasText: 'Agent tools are unavailable' })
    .waitFor();
  await page.locator('#album-slug').fill('first-light');
  await page.locator('form[data-album-lookup] button').click();
  await page.locator('[data-lookup-result]').filter({ hasText: 'first-light' }).waitFor();
  const found = await page.locator('[data-lookup-result]').innerText();
  await page.locator('#album-slug').fill('not-in-catalog');
  await page.locator('form[data-album-lookup] button').click();
  await page.locator('[data-lookup-result]').filter({ hasText: 'missing' }).waitFor();
  const missing = JSON.parse(await page.locator('[data-lookup-result]').innerText());
  assert.equal(missing.kind, 'missing');
  assert.equal(page.url(), origin + '/albums/');
  await page.locator('nav a[href="/about/"]').click();
  await page.waitForURL(origin + '/about/');
  await page.getByRole('heading', { name: 'Existing pages stay in place.' }).waitFor();
  await page.locator('nav a[href="/albums/"]').click();
  await page.waitForURL(origin + '/albums/');
  await page
    .locator('[data-agent-status]')
    .filter({ hasText: 'Agent tools are unavailable' })
    .waitFor();
  await page.locator('#album-slug').fill('blue-hour');
  await page.locator('form[data-album-lookup] button').click();
  await page.locator('[data-lookup-result]').filter({ hasText: 'blue-hour' }).waitFor();
  const afterNavigation = JSON.parse(await page.locator('[data-lookup-result]').innerText());
  assert.equal(afterNavigation.album.slug, 'blue-hour');
  assert.equal(page.url(), origin + '/albums/');
  assert.equal(errors.length, 0);
  console.log(
    JSON.stringify(
      {
        result: 'pass',
        chrome: browser.version(),
        nativeWebMcp,
        found: JSON.parse(found).album.slug,
        missing: missing.kind,
        afterNavigation: afterNavigation.album.slug,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
