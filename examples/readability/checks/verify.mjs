import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { planPublication } from '../../../dist/publication.js';
import { verifyPublication } from '../../../bin/verify-publication.mjs';

const privateMarkerPattern = /PRIVATE-(?:DRAFT|ATTENDEE|TRANSIT)-|SERVICE-ONLY-CALIBRATION-/;

const fixtures = {
  astro: '/field-notes/breakwater',
  next: '/courses/field-recording',
  'react-vite': '/tracks/night-ferry',
  'vue-vite': '/parts/brass-coupler',
  sveltekit: '/events/lanterns',
  nuxt: '/fr/exhibits/boussole',
  'react-router': '/lines/river/stops/quay',
  angular: '/equipment/atlas-7',
};
const framework = process.argv[2];
const humanOnly = process.argv.includes('--human-only');
const remote = process.argv.includes('--remote');
assert.ok(Object.hasOwn(fixtures, framework), 'Supply a supported framework fixture name');
const dir = fileURLToPath(new URL('../' + framework + '/', import.meta.url));
const readModel = async (name) =>
  JSON.parse(await readFile(path.join(dir, 'generated', name), 'utf8'));
const manifest = await readModel('manifest.json');
const model = await readModel('publication.json');
assert.equal(model.publicationEnabled, !humanOnly, 'Select the matching publication mode');
const origin = new URL(model.siteUrl);
if (remote) {
  assert.equal(
    origin.protocol,
    'https:',
    'Hosted conformance requires the configured HTTPS origin',
  );
} else {
  assert.equal(origin.hostname, '127.0.0.1', 'Local conformance binds a loopback server');
  assert.ok(origin.port);
}
const env = {
  ...process.env,
  PORT: origin.port,
  HOST: origin.hostname,
  HOSTNAME: origin.hostname,
  NITRO_PORT: origin.port,
  NITRO_HOST: origin.hostname,
};
const win = process.platform === 'win32';
const server = remote
  ? null
  : spawn(win ? 'npm.cmd' : 'npm', ['start'], {
      cwd: dir,
      env,
      shell: win,
      detached: !win,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
let tail = '';
for (const stream of server ? [server.stdout, server.stderr] : [])
  stream.on('data', (chunk) => {
    tail = (tail + chunk).slice(-6000);
  });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server && server.exitCode !== null)
      throw Error(`Production server exited ${server.exitCode}: ${tail}`);
    try {
      ready = (
        await fetch(new URL(humanOnly ? fixtures[framework] : '/llms.txt', origin), {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {}
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, 'Server failed to expose the selected experience: ' + tail);
  const plan = await planPublication(manifest.config, manifest.candidates);
  const actualShowcase = model.pages.find((page) => page.route === fixtures[framework]);
  assert.ok(actualShowcase, 'Expected native showcase route in the approved publication');
  const original = process.env.READABILITY_EDITION === 'original';
  const witness = await fetch(new URL('/agent-native-witness.json', origin));
  assert.equal(witness.status, 200);
  const identity = await witness.json();
  assert.equal(identity.edition, original ? 'original' : 'updated');
  if (process.env.READABILITY_PROOF_CODE) {
    assert.equal(
      identity.proofCodeHash,
      createHash('sha256').update(process.env.READABILITY_PROOF_CODE).digest('hex'),
    );
    assert.ok(
      (
        await (
          await fetch(
            new URL(humanOnly ? '/guides/meridian' : '/agent-native/guides/meridian.md', origin),
          )
        ).text()
      ).includes(process.env.READABILITY_PROOF_CODE),
    );
  }
  const probes = {
    responses: [
      {
        path: '/llms-full.txt',
        status: 200,
        contains: [original ? 'Pier Four' : 'Pier Seven', actualShowcase.title],
        excludes: original
          ? ['Pier Seven', '/account/settings']
          : ['Pier Four', 'dry dock', '/account/settings'],
      },
      { path: '/agent-native/guides/retired.md', status: original ? 200 : 404 },
    ],
  };
  let result = { checks: [] };
  if (humanOnly) {
    for (const route of ['/llms.txt', '/llms-full.txt', '/agent-native/guides/meridian.md']) {
      const reply = await fetch(new URL(route, origin));
      assert.ok([404, 410].includes(reply.status), route);
      result.checks.push({ test: 'disabled-resource', url: route, pass: true });
    }
  } else {
    result = await verifyPublication(plan, manifest.config, probes, manifest.candidates);
    assert.equal(
      result.status,
      'verified',
      JSON.stringify(result.checks.filter((check) => !check.pass)),
    );
  }
  for (const route of ['/account/settings', '/draft/inspection']) {
    const reply = await fetch(new URL(route, origin));
    assert.ok([401, 403, 404].includes(reply.status), route);
    assert.doesNotMatch(await reply.text(), privateMarkerPattern);
    result.checks.push({
      test: 'protected-boundary',
      url: route,
      pass: true,
      status: reply.status,
    });
  }
  if (!humanOnly && !original && ['sveltekit', 'react-router'].includes(framework)) {
    const native = spawnSync(process.execPath, ['--test', 'test.mjs'], {
      cwd: dir,
      env: { ...env, SITE_URL: origin.href },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(native.status, 0, native.stderr + native.stdout);
  }
  if (!process.argv.includes('--http-only')) {
    browser = await chromium.launch(
      process.env.READABILITY_CHROMIUM ? { executablePath: process.env.READABILITY_CHROMIUM } : {},
    );
    const page = await browser.newPage();
    let payloadChecks = [];
    page.on('response', (response) => {
      if (new URL(response.url()).origin !== origin.origin || response.status() !== 200) return;
      // Retain failures as observations until the page's complete response set is drained.
      payloadChecks.push(
        response.body().then(
          (bytes) => ({
            readable: true,
            privateMarker: privateMarkerPattern.test(bytes.toString()),
          }),
          () => ({ readable: false, privateMarker: false }),
        ),
      );
    });
    await page.goto(new URL(actualShowcase.route, origin).href);
    await page.getByRole('heading', { name: actualShowcase.title, exact: true }).first().waitFor();
    assert.equal(
      new URL(await page.locator('link[rel=canonical]').first().getAttribute('href'), page.url())
        .href,
      actualShowcase.canonical,
    );
    if (humanOnly) {
      assert.equal(await page.locator('link[rel=alternate][type="text/markdown"]').count(), 0);
      assert.equal(await page.locator('script[type="application/ld+json"]').count(), 0);
    }
    if (['astro', 'next', 'react-vite', 'vue-vite'].includes(framework)) {
      await (await import('../shared/four-browser-checks.mjs')).verifyInteraction(
        framework,
        page,
        origin,
        original ? 'original' : 'updated',
      );
    }
    if (['sveltekit', 'react-router'].includes(framework)) {
      await (await import('../shared/loader-browser-checks.mjs')).verifyInteraction(
        framework,
        page,
        origin,
      );
    }
    if (framework === 'angular') {
      await page.getByRole('button', { name: 'Start checklist' }).click();
      const checkbox = page.getByLabel('Torque collar inspected');
      await checkbox.check();
      await page.getByText('Inspection complete', { exact: true }).waitFor();
    }
    if (framework === 'nuxt') {
      await page.getByRole('link', { name: 'Harbor compass', exact: true }).click();
      await page.getByRole('heading', { name: 'Harbor compass', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal((await page.goto(new URL('/fr/exhibits/carte', origin).href)).status(), 404);
    }
    await page.waitForLoadState('networkidle');
    const payloads = await Promise.all(payloadChecks);
    assert.ok(payloads.length > 0, 'A positive browser response control must be observed');
    assert.ok(
      payloads.every((observation) => observation.readable && !observation.privateMarker),
      'Browser-visible payloads must be readable and omit private controls',
    );
    result.checks.push({ test: 'browser-payload-privacy', pass: true, responses: payloads.length });
  }
  console.log(
    JSON.stringify({
      framework,
      mode: remote ? 'hosted production' : 'local production',
      origin: origin.href,
      publication: humanOnly ? 'disabled' : 'enabled',
      httpChecks: result.checks.length,
      showcase: actualShowcase.route,
      chromium: browser?.version() ?? null,
    }),
  );
} finally {
  await browser?.close();
  stopServer();
}

function stopServer() {
  if (server?.pid && server.exitCode === null) {
    if (win) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}
