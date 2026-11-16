// Opt-in browser acceptance for the UI renderer on React 19, like the other uan023 browser
// checks. Not part of `npm test`. Needs Google Chrome and playwright-core, for example:
//   npm install --no-save playwright-core@1.64.1
//   node test/ui-react19-browser.mjs [--screenshots DIR]
// Bundles test/ui-react19-browser/host.ts with esbuild in React development mode, so React's own
// warnings surface, serves it on 127.0.0.1 and drives headless Chrome.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostDir = path.join(root, 'test', 'ui-react19-browser');
const shotsArg = process.argv.indexOf('--screenshots');
const shots = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : undefined;
const shoot = async (page, name) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
};
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const bundle = await build({
  entryPoints: [path.join(hostDir, 'host.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'silent',
});
const files = {
  '/': ['text/html; charset=utf-8', await readFile(path.join(hostDir, 'index.html'))],
  '/host.js': ['text/javascript; charset=utf-8', bundle.outputFiles[0].contents],
};
const server = createServer((request, response) => {
  const file = files[new URL(request.url, 'http://127.0.0.1').pathname];
  if (file === undefined) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': file[0] }).end(file[1]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

if (shots) await mkdir(shots, { recursive: true });
const results = [];
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()))
      problems.push(`${message.type()}: ${message.text()}`);
  });
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => 'anui' in globalThis);
  const react = await page.evaluate(() => document.querySelector('script')?.src);
  assert.ok(react);

  // Review Queue
  await page.evaluate(() => globalThis.anui.load('review'));
  const field = page.getByRole('textbox', { name: 'Edit Landing page review', exact: true });
  await check(
    'typing updates the local draft and keeps focus across React re-renders',
    async () => {
      await field.fill('Edited locally in React 19.');
      await field.pressSequentially(' More.');
      assert.equal(
        await page.evaluate(() => globalThis.anui.store.read('review', '/records/alpha/draft')),
        'Edited locally in React 19. More.',
      );
      assert.ok(await field.evaluate((el) => el === document.activeElement));
    },
  );
  await check('a selected record saves through the registered action', async () => {
    await page.getByRole('checkbox', { name: 'Select Landing page review', exact: true }).check();
    await page.getByRole('button', { name: 'Save selected', exact: true }).click();
    await page.waitForFunction(() => globalThis.anui.trace.length === 1);
    await page.waitForFunction(
      () => globalThis.anui.store.snapshot('review').receipts.get('saveReview')?.kind === 'success',
    );
    assert.equal(
      await page.evaluate(() => globalThis.anui.store.read('review', '/records/alpha/before')),
      'Edited locally in React 19. More.',
    );
  });
  await check('a denied save is shown and the unfinished edit is kept', async () => {
    await page.evaluate(() => globalThis.anui.setDeny(true));
    await field.fill('Denied edit retained.');
    await page.getByRole('button', { name: 'Save selected', exact: true }).click();
    await page.waitForFunction(() => globalThis.anui.trace.length === 2);
    await page.getByText('Fixture policy denied this save.').waitFor();
    assert.equal(await field.inputValue(), 'Denied edit retained.');
    await page.evaluate(() => globalThis.anui.setDeny(false));
  });
  await check('an incoming agent update does not overwrite a local edit', async () => {
    await field.fill('My local wording.');
    await page.evaluate(() =>
      globalThis.anui.store.apply(
        globalThis.anui.update('review', '/records/alpha/draft', 'Agent wording.'),
      ),
    );
    assert.equal(await field.inputValue(), 'My local wording.');
    await page.getByRole('button', { name: 'Keep my edit' }).first().waitFor();
    await page.getByRole('button', { name: 'Use server value' }).first().click();
    assert.equal(await field.inputValue(), 'Agent wording.');
  });

  await shoot(page, 'review-desktop');

  // Parameter Explorer
  await page.evaluate(() => globalThis.anui.load('explore'));
  await check('a slider recalculates locally without calling an action', async () => {
    const before = await page.evaluate(() => globalThis.anui.trace.length);
    const slider = page.getByRole('slider', { name: 'Attempts' });
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('output[aria-live="polite"]').filter({ hasText: '25.19' }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.anui.store.read('explore', '/attempts')), 4);
    assert.equal(await page.evaluate(() => globalThis.anui.trace.length), before);
  });

  await shoot(page, 'explore-desktop');

  // Media Annotation
  await page.evaluate(() => globalThis.anui.load('media'));
  await check('audio loads without autoplay and an annotation can be added and saved', async () => {
    const audio = page.locator('audio');
    await audio.waitFor({ state: 'attached' });
    await page.waitForFunction(() => (document.querySelector('audio')?.readyState ?? 0) >= 1);
    assert.equal(await audio.evaluate((el) => el.paused), true);
    assert.equal(await audio.evaluate((el) => el.autoplay), false);
    const playhead = page.getByRole('slider').first();
    await playhead.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => globalThis.anui.store.read('media', '/position')), 0.1);
    await page.getByRole('button', { name: /^Add at 0:00\.1/ }).click();
    await page.getByRole('textbox', { name: 'Annotation 1 note' }).fill('Tone starts');
    await page.getByRole('button', { name: 'Save annotations', exact: true }).click();
    await page.waitForFunction(
      () =>
        globalThis.anui.store.snapshot('media').receipts.get('saveAnnotations')?.kind === 'success',
    );
    const saved = await page.evaluate(() => globalThis.anui.store.read('media', '/annotations'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].text, 'Tone starts');
  });

  await shoot(page, 'media-desktop');

  // Narrow layout
  await page.setViewportSize({ width: 375, height: 812 });
  for (const name of ['review', 'explore', 'media'])
    await check(`${name} fits a 375px viewport without horizontal scrolling`, async () => {
      await page.evaluate((id) => globalThis.anui.load(id), name);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 375, `scrollWidth ${width}`);
      await shoot(page, `${name}-mobile`);
    });

  await check('no page errors or React warnings were reported', async () => {
    assert.deepEqual(problems, []);
  });
} finally {
  await browser.close();
  server.close();
}
console.log(`${results.length} checks passed`);
