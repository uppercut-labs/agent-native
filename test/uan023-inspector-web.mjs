import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import {
  startE09Server,
  albumToolName,
  getHandlerCalls,
} from '../examples/e09-album-explorer/.exported/src/server.mjs';

const token = randomBytes(24).toString('hex');
const webPort = 6484;
const inspector = spawn('npx', ['--yes', '@modelcontextprotocol/inspector@2.8.0', '--web'], {
  cwd: process.cwd(),
  detached: true,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    CLIENT_PORT: String(webPort),
    MCP_SANDBOX_PORT: '6485',
    MCP_APP_ORIGIN_PORT: '6488',
    MCP_AUTO_OPEN_ENABLED: 'false',
    MCP_INSPECTOR_API_TOKEN: token,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let inspectorLogs = '';
for (const stream of [inspector.stdout, inspector.stderr]) {
  stream.setEncoding('utf8').on('data', (chunk) => {
    inspectorLogs = (inspectorLogs + chunk).slice(-5000);
  });
}
let browser;
let page;
let server;
const consoleErrors = [];
const requestFailures = [];
try {
  server = await startE09Server();
  const inspectorOrigin = 'http://127.0.0.1:' + webPort;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (inspector.exitCode !== null) throw new Error('Inspector exited before serving the web UI.');
    try {
      const response = await fetch(inspectorOrigin);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert.ok(ready, 'Inspector web UI did not become ready.');
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    requestFailures.push({ url: request.url(), failure: request.failure() }),
  );
  const args = Buffer.from(JSON.stringify({ slug: 'first-light' })).toString('base64url');
  const url =
    inspectorOrigin +
    '/?serverUrl=' +
    encodeURIComponent(server.origin + '/mcp') +
    '&transport=http&autoConnect=' +
    token +
    '&openApp=' +
    encodeURIComponent(albumToolName) +
    '&appArgs=' +
    args +
    '&autoOpen=' +
    token;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page
    .locator('[data-testid="connection-status"][data-status="connected"]')
    .waitFor({ timeout: 30000 });
  await page.locator('[data-app-status="ready"]').waitFor({ timeout: 30000 });
  let appFrame;
  for (let attempt = 0; attempt < 80; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        if (await frame.locator('#status').count()) {
          appFrame = frame;
          break;
        }
      } catch {}
    }
    if (appFrame) break;
    await delay(250);
  }
  assert.ok(appFrame, 'No embedded Album Explorer frame appeared.');
  await appFrame.locator('#status').filter({ hasText: 'First Light' }).waitFor({ timeout: 15000 });
  const initial = await appFrame.locator('#status').innerText();
  await appFrame.locator('#slug').fill('blue-hour');
  await appFrame.locator('#lookup-form button').click();
  await appFrame.locator('#status').filter({ hasText: 'Blue Hour' }).waitFor({ timeout: 15000 });
  const followup = await appFrame.locator('#status').innerText();
  await appFrame.locator('#slug').fill('blocked-album');
  await appFrame.locator('#lookup-form button').click();
  await appFrame
    .locator('#status')
    .filter({ hasText: /denied/i })
    .waitFor({ timeout: 15000 });
  const denied = await appFrame.locator('#status').innerText();
  assert.match(initial, /First Light/);
  assert.match(followup, /Blue Hour/);
  assert.match(denied, /denied/i);
  assert.equal(getHandlerCalls(), 2, 'Denied call must not execute the binding.');
  assert.equal(errors.length, 0);
  assert.equal(
    consoleErrors.filter((message) => message.includes('Content Security Policy')).length,
    0,
  );
  console.log(
    JSON.stringify(
      {
        result: 'pass',
        inspector: '2.8.0',
        playwright: '1.56.1',
        chrome: browser.version(),
        appFrameUrl: appFrame.url(),
        initial,
        followup,
        denied,
        handlerCalls: getHandlerCalls(),
        frameCount: page.frames().length,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        result: 'fail',
        error: String(error),
        inspectorExitCode: inspector.exitCode,
        inspectorLogTail: inspectorLogs.replaceAll(token, '[redacted]'),
        connection: page
          ? await page
              .locator('[data-testid="connection-status"]')
              .evaluateAll((nodes) =>
                nodes.map((node) => ({
                  status: node.getAttribute('data-status'),
                  error: node.getAttribute('data-error-message'),
                  deeplink: node.getAttribute('data-deeplink'),
                })),
              )
              .catch(() => [])
          : [],
        appStatuses: page
          ? await page
              .locator('[data-app-status]')
              .evaluateAll((nodes) =>
                nodes.map((node) => ({
                  status: node.getAttribute('data-app-status'),
                  text: node.textContent?.slice(0, 300),
                })),
              )
              .catch(() => [])
          : [],
        body: page
          ? (
              await page
                .locator('body')
                .innerText()
                .catch(() => '')
            ).slice(0, 1200)
          : '',
        frames: page
          ? await Promise.all(
              page.frames().map(async (frame) => ({
                url: frame.url().replaceAll(token, '[redacted]'),
                body: (
                  await frame
                    .locator('body')
                    .innerText()
                    .catch(() => '')
                ).slice(0, 900),
                html: await frame
                  .locator('html')
                  .evaluate((element) => element.outerHTML.slice(0, 600))
                  .catch(() => ''),
              })),
            )
          : [],
        consoleErrors: typeof consoleErrors !== 'undefined' ? consoleErrors : [],
        requestFailures: requestFailures.map((request) => ({
          ...request,
          url: request.url.replaceAll(token, '[redacted]'),
        })),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  if (inspector.pid) {
    try {
      process.kill(-inspector.pid, 'SIGTERM');
    } catch {}
  }
}
