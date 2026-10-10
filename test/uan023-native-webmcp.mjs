import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const exported = (name) =>
  fileURLToPath(new URL(`../examples/${name}/.exported/dist/`, import.meta.url));
const e06Dist = exported('e06-browser-only-theme-controls');
const e01Dist = exported('e01-album-catalog');
for (const [script, dir] of [
  ['example:e06', e06Dist],
  ['example:e01', e01Dist],
]) {
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`Run npm run ${script} first to build the standalone page.`);
  }
}
if (!existsSync(chrome)) throw new Error(`Set CHROME_PATH; no Chrome found at ${chrome}.`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
types['.svg'] = 'image/svg+xml';
async function serve(distDir) {
  const site = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = normalize(join(distDir, relative));
    if (!file.startsWith(distDir) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const type = types[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    response.end(readFileSync(file));
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  assert.ok(address !== null && typeof address === 'object');
  return { site, origin: `http://127.0.0.1:${address.port}` };
}
const e06 = await serve(e06Dist);
const e01 = await serve(e01Dist);
const pageUrl = `${e06.origin}/`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withChrome(features, run) {
  const profile = mkdtempSync(join(tmpdir(), 'uan023-webmcp-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const args = [
    '--headless=new',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
  ];
  if (features !== undefined) args.push(`--enable-features=${features}`);
  const child = spawn(chrome, [...args, 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let attempt = 0; attempt < 50 && target === undefined; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
          method: 'PUT',
        });
        target = await response.json();
      } catch {
        await sleep(200);
      }
    }
    assert.ok(target !== undefined, 'Chrome DevTools endpoint did not start');
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    const events = [];
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) pending.get(message.id)?.(message);
      else if (message.method?.startsWith('WebMCP.')) events.push(message);
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        nextId += 1;
        pending.set(nextId, resolve);
        socket.send(JSON.stringify({ id: nextId, method, params }));
      });
    const evaluate = async (expression) => {
      const reply = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return reply.result?.result?.value;
    };
    const waitFor = async (predicate) => {
      for (let waited = 0; waited < 5000; waited += 100) {
        const found = events.find(predicate);
        if (found !== undefined) return found;
        await sleep(100);
      }
      return undefined;
    };
    try {
      return await run({ browser: version.Browser, send, evaluate, waitFor, events });
    } finally {
      socket.close();
    }
  } finally {
    child.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

const supportText = "document.querySelector('#support')?.textContent";
const themeText = 'document.documentElement.dataset.theme';

try {
  const fallback = await withChrome(undefined, async ({ browser, send, evaluate }) => {
    await send('Page.enable');
    await send('Page.navigate', { url: pageUrl });
    await sleep(2500);
    return {
      browser,
      modelContext: await evaluate('typeof document.modelContext'),
      support: await evaluate(supportText),
    };
  });
  assert.equal(fallback.modelContext, 'undefined');
  assert.equal(fallback.support, 'WebMCP is unavailable here; use the human theme control above.');
  console.log(`${fallback.browser} default: no document.modelContext; human fallback shown.`);

  await withChrome('WebMCP', async ({ browser, send, evaluate, waitFor, events }) => {
    await send('Page.enable');
    const enabled = await send('WebMCP.enable');
    assert.equal(enabled.error, undefined);
    await send('Page.navigate', { url: pageUrl });
    await sleep(2500);
    assert.equal(await evaluate(supportText), 'Browser tool registrations: 1.');

    const added = await waitFor((event) => event.method === 'WebMCP.toolsAdded');
    assert.ok(added !== undefined, 'Chrome did not report the registered tool');
    assert.equal(added.params.tools.length, 1);
    const tool = added.params.tools[0];
    assert.equal(tool.name, 'uan.15.example.browser.9.theme.set.v1');
    assert.deepEqual(tool.inputSchema.properties.theme.enum, ['light', 'dark']);
    assert.deepEqual(tool.annotations, {
      readOnly: false,
      untrustedContent: false,
      consequential: false,
    });
    console.log(`${browser} WebMCP: toolsAdded ${tool.name}`);

    const invoke = async (input) => {
      const before = events.length;
      const invoked = await send('WebMCP.invokeTool', {
        frameId: tool.frameId,
        toolName: tool.name,
        input,
      });
      assert.equal(invoked.error, undefined);
      const responded = await waitFor(
        (event, index) =>
          index >= before &&
          event.method === 'WebMCP.toolResponded' &&
          event.params.invocationId === invoked.result.invocationId,
      );
      assert.ok(responded !== undefined, 'Chrome did not report a tool response');
      return responded.params;
    };

    const found = await invoke({ theme: 'dark' });
    assert.equal(found.status, 'Completed');
    assert.deepEqual(found.output, {
      ok: true,
      capabilityId: 'example.browser:theme.set@1',
      value: { theme: 'dark' },
    });
    assert.equal(await evaluate(themeText), 'dark');
    console.log('invokeTool {theme:"dark"}: Completed, page theme dark');

    const invalid = await invoke({ theme: 'purple' });
    assert.equal(invalid.status, 'Completed');
    assert.deepEqual(invalid.output, { ok: false, error: 'Capability input is invalid.' });
    assert.equal(await evaluate(themeText), 'dark');
    console.log('invokeTool {theme:"purple"}: safe invalid-input envelope, theme unchanged');

    const disposal = await evaluate(`(async () => {
      const before = (await document.modelContext.getTools()).length;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = (await document.modelContext.getTools()).length;
      return { before, after };
    })()`);
    assert.deepEqual(disposal, { before: 1, after: 0 });
    console.log('pagehide: adapter AbortSignal removed the native registration (1 -> 0)');
  });

  await withChrome('WebMCP', async ({ browser, send, evaluate }) => {
    await send('Page.enable');
    await send('Page.navigate', { url: `${e01.origin}/albums/` });
    await sleep(2500);
    const flagship = await evaluate(`(async () => {
      const modelContext = document.modelContext;
      const status = () => document.querySelector('[data-agent-status]')?.textContent;
      const tools = await modelContext.getTools();
      const tool = tools[0];
      const found = await modelContext.executeTool(tool, { slug: 'first-light' });
      const missing = await modelContext.executeTool(tool, { slug: 'no-such-album' });
      const statusBefore = status();
      const about = [...document.querySelectorAll('a')].find((link) =>
        link.getAttribute('href')?.includes('about'),
      );
      about.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const aboutPath = location.pathname;
      const aboutTools = (await modelContext.getTools()).length;
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return {
        names: tools.map((item) => item.name),
        readOnlyHint: tool.annotations.readOnlyHint,
        found: JSON.parse(found),
        missing: JSON.parse(missing),
        statusBefore,
        aboutPath,
        aboutTools,
        backPath: location.pathname,
        backTools: (await modelContext.getTools()).map((item) => item.name),
      };
    })()`);
    const name = 'uan.15.example.catalog.12.album.lookup.v1';
    assert.deepEqual(flagship.names, [name]);
    assert.equal(flagship.readOnlyHint, true);
    assert.deepEqual(flagship.found, {
      ok: true,
      capabilityId: 'example.catalog:album.lookup@1',
      value: { kind: 'found', album: { slug: 'first-light', title: 'First Light' } },
    });
    assert.deepEqual(flagship.missing.value, { kind: 'missing' });
    assert.equal(flagship.statusBefore, 'Browser agent tools are available for this page.');
    assert.equal(flagship.aboutPath, '/about/');
    assert.equal(flagship.aboutTools, 0);
    assert.equal(flagship.backPath, '/albums/');
    assert.deepEqual(flagship.backTools, [name]);
    console.log(`${browser} WebMCP E01: found/missing lookups, client navigation removes and`);
    console.log('back navigation restores the static albums page tool');
  });
} finally {
  e06.site.close();
  e01.site.close();
}
