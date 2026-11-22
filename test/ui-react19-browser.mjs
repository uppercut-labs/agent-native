// Opt-in browser acceptance for the UI renderer on React 19, like the other uan023 browser
// checks. Not part of `npm test`. Needs Google Chrome and playwright-core, for example:
//   npm install --no-save playwright-core@1.64.1
//   node test/ui-react19-browser.mjs [--screenshots DIR]
// Bundles test/ui-react19-browser/host.ts with esbuild in React development mode, so React's own
// warnings surface, serves it on 127.0.0.1 and drives headless Chrome.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  if (shots)
    await page.screenshot({
      path: path.join(shots, `${name}.png`),
      fullPage: true,
    });
};
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Runs in the page. Reports horizontal scroll, elements whose box leaves the viewport and
// content cut off by an overflow:hidden/clip ancestor or by its own box.
function measureLayout() {
  const doc = document.scrollingElement;
  const width = document.documentElement.clientWidth;
  const describe = (el) => {
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/)[0]}` : ''} "${label}"`;
  };
  const overflowing = [];
  const clipped = [];
  const inScroller = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (/(auto|scroll)/.test(o.overflowX) && a.scrollWidth > a.clientWidth) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('#surface *')) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || style.display === 'none') continue;
    if (style.position === 'absolute' && rect.width <= 1 && rect.height <= 1) continue;
    if ((rect.right > width + 0.5 || rect.left < -0.5) && !inScroller(el))
      overflowing.push(
        `${describe(el)} [${Math.round(rect.left)}..${Math.round(rect.right)}] of ${width}`,
      );
    if (/(hidden|clip)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1)
      clipped.push(`${describe(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    if (/(hidden|clip)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
      clipped.push(
        `${describe(el)} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`,
      );
    if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1)
      clipped.push(`${describe(el)} ellipsis`);
    // A control partly hidden by a clipping ancestor.
    if (el.matches('button,input,select,textarea,a[href],audio,[role=slider]'))
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (!/(hidden|clip|auto|scroll)/.test(o.overflowX + o.overflowY)) continue;
        const box = a.getBoundingClientRect();
        if (
          rect.left < box.left - 0.5 ||
          rect.right > box.right + 0.5 ||
          rect.top < box.top - 0.5 ||
          rect.bottom > box.bottom + 0.5
        ) {
          clipped.push(`${describe(el)} cut by ${describe(a)}`);
          break;
        }
      }
  }
  return {
    horizontalScroll: doc.scrollWidth > doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflowing,
    clipped,
  };
}

// Tabs through every control and checks each focus stop: it is the next control in DOM order, its
// box intersects the viewport vertically (focus scrolls it in; a tall scroll region may be taller than the viewport) and sits inside it horizontally and it shows a focus indicator.
async function tabThrough(page) {
  const expected = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
    };
    const nodes = [
      ...document.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),audio[controls],video[controls],[tabindex]:not([tabindex="-1"])',
      ),
    ].filter(visible);
    globalThis.__tabbable = nodes;
    // Put the sequential focus starting point at the top of the page, like a fresh load.
    const start = document.createElement('span');
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    start.remove();
    return nodes.map(
      (el) =>
        el.getAttribute('aria-label') ||
        el.getAttribute('name') ||
        (el.textContent || '').trim().slice(0, 30) ||
        el.tagName,
    );
  });
  const stops = [];
  const problems = [];
  let mediaStops = 0;
  let i = 0;
  let presses = 0;
  while (i < expected.length && presses < expected.length * 8) {
    await page.keyboard.press('Tab');
    presses += 1;
    // Native audio and video controls take several Tab stops inside one element.
    if (
      stops.length > 0 &&
      stops.at(-1) ===
        (await page.evaluate(() => globalThis.__tabbable.indexOf(document.activeElement))) &&
      (await page.evaluate(() => document.activeElement instanceof HTMLMediaElement))
    ) {
      mediaStops += 1;
      continue;
    }
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      const index = globalThis.__tabbable.indexOf(el);
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const shadowed = style.boxShadow !== 'none';
      return {
        index,
        focusVisible: el.matches(':focus-visible'),
        indicator: outlined || shadowed,
        inViewport:
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          rect.left >= -0.5 &&
          rect.right <= document.documentElement.clientWidth + 0.5,
        clippedFocus: (() => {
          for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            const o = getComputedStyle(a);
            if (!/(hidden|clip)/.test(o.overflowX + o.overflowY)) continue;
            const box = a.getBoundingClientRect();
            if (rect.left - 2 < box.left || rect.right + 2 > box.right) return true;
          }
          return false;
        })(),
      };
    });
    stops.push(stop.index);
    const name = expected[i];
    if (stop.index !== i)
      problems.push(`stop ${i + 1} "${name}" landed on tabbable #${stop.index}`);
    if (!stop.focusVisible) problems.push(`"${name}" does not match :focus-visible`);
    if (!stop.indicator) problems.push(`"${name}" has no outline or shadow when focused`);
    if (!stop.inViewport) problems.push(`"${name}" is outside the viewport when focused`);
    if (stop.clippedFocus) problems.push(`"${name}" focus ring is cut by an ancestor`);
    i += 1;
  }
  if (i < expected.length) problems.push(`Tab reached ${i} of ${expected.length} controls`);
  return {
    tabStops: expected.length,
    mediaInternalStops: mediaStops,
    focusOrder: stops,
    problems,
  };
}

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

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
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
  const field = page.getByRole('textbox', {
    name: 'Edit Landing page review',
    exact: true,
  });
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
    await page
      .getByRole('checkbox', {
        name: 'Select Landing page review',
        exact: true,
      })
      .check();
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

  // 200% browser zoom (640x400 CSS px at device scale 2, a 1280x800 window at 200%) and 320 CSS px
  // wide: no horizontal scroll, no overflowing or clipped content, and a visible, ordered Tab path.
  const zoomRows = [];
  const zoomViewports = [
    { label: 'zoom200', width: 640, height: 400 },
    { label: 'w320', width: 320, height: 640 },
  ];
  const zoomCases = ['review', 'review-conflict', 'explore', 'media'];
  for (const viewport of zoomViewports)
    for (const scheme of ['light', 'dark'])
      for (const name of zoomCases)
        await check(`${name} at ${viewport.label} in ${scheme} theme`, async () => {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 2,
            colorScheme: scheme,
          });
          const zoomPage = await context.newPage();
          zoomPage.setDefaultTimeout(5000);
          zoomPage.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
          zoomPage.on('console', (message) => {
            if (['error', 'warning'].includes(message.type()))
              problems.push(`${message.type()}: ${message.text()}`);
          });
          try {
            await zoomPage.goto(`${origin}/`);
            await zoomPage.waitForFunction(() => 'anui' in globalThis);
            const pattern = name.split('-')[0];
            await zoomPage.evaluate((id) => globalThis.anui.load(id), pattern);
            if (name === 'review-conflict') {
              const edit = zoomPage.getByRole('textbox', {
                name: 'Edit Landing page review',
                exact: true,
              });
              await edit.fill('My local wording.');
              await zoomPage.evaluate(() =>
                globalThis.anui.store.apply(
                  globalThis.anui.update('review', '/records/alpha/draft', 'Agent wording.'),
                ),
              );
              await zoomPage.getByRole('button', { name: 'Keep my edit' }).first().waitFor();
            }
            if (name === 'media') {
              await zoomPage.waitForFunction(
                () => (document.querySelector('audio')?.readyState ?? 0) >= 1,
              );
              await zoomPage.getByRole('slider').first().focus();
              await zoomPage.keyboard.press('ArrowRight');
              await zoomPage.getByRole('button', { name: /^Add at 0:00\.1/ }).click();
              await zoomPage.getByRole('textbox', { name: 'Annotation 1 note' }).waitFor();
            }
            await zoomPage.evaluate(() => {
              document.activeElement?.blur();
              document.scrollingElement.scrollTo(0, 0);
            });
            const layout = await zoomPage.evaluate(measureLayout);
            const focus = await tabThrough(zoomPage);
            const row = {
              viewport: viewport.label,
              scheme,
              pattern: name,
              ...layout,
              ...focus,
            };
            zoomRows.push(row);
            await zoomPage.evaluate(() => document.activeElement?.blur());
            await shoot(zoomPage, `${name}-${viewport.label}-${scheme}`);
            assert.equal(layout.horizontalScroll, false, `horizontal scroll ${layout.scrollWidth}`);
            assert.deepEqual(layout.overflowing, [], 'elements outside the viewport');
            assert.deepEqual(layout.clipped, [], 'clipped content');
            assert.deepEqual(focus.problems, [], 'focus problems');
          } finally {
            await context.close();
          }
        });
  if (shots)
    await writeFile(
      path.join(shots, 'zoom-results.json'),
      `${JSON.stringify(zoomRows, null, 2)}\n`,
    );

  await check('no page errors or React warnings were reported', async () => {
    assert.deepEqual(problems, []);
  });
} finally {
  await browser.close();
  server.close();
}
console.log(`${results.length} checks passed`);
