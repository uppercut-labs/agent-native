import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';

const projectUrl = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, projectUrl), 'utf8');
}

async function getAvailablePort() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');

  const address = reservation.address();
  assert(address && typeof address === 'object');

  await new Promise((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Astro server exited before becoming ready with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Astro server did not become ready at ${url}.`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;

  child.kill('SIGTERM');
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(resolve, 3_000, 'timeout');
    timer.unref();
  });
  const result = await Promise.race([once(child, 'exit'), timeout]);
  if (result === 'timeout') child.kill('SIGKILL');
}

test('E02 remains a conventional mixed Astro site before integration', async (context) => {
  await context.test('pins an installed official adapter compatible with Astro 7.3.5', async () => {
    const astroPackage = JSON.parse(await readProjectFile('node_modules/astro/package.json'));
    const nodeAdapterPackage = JSON.parse(
      await readProjectFile('node_modules/@astrojs/node/package.json'),
    );

    assert.equal(astroPackage.version, '7.3.5');
    assert.equal(nodeAdapterPackage.version, '11.1.6');
    assert.equal(nodeAdapterPackage.peerDependencies.astro, '^7.2.1');
    assert.equal(nodeAdapterPackage.repository.directory, 'packages/integrations/node');
  });

  await context.test('prerenders the human catalog and unrelated about page', async () => {
    const homeHtml = await readProjectFile('dist/client/index.html');
    const catalogHtml = await readProjectFile('dist/client/albums/index.html');
    const aboutHtml = await readProjectFile('dist/client/about/index.html');

    assert.match(homeHtml, /href="\/albums\/"/);
    assert.match(homeHtml, /href="\/about\/"/);
    assert.match(catalogHtml, /After the Rain/);
    assert.match(catalogHtml, /href="\/api\/albums\/after-the-rain\.json"/);
    assert.match(aboutHtml, /intentionally unrelated to album lookup/);
    assert.match(aboutHtml, /href="\/albums\/"/);
  });

  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['./dist/server/entry.mjs'], {
    cwd: projectUrl,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk;
  });

  try {
    await waitForServer(`${baseUrl}/`, server);

    await context.test('serves normal human navigation from the production server', async () => {
      for (const path of ['/', '/albums/', '/about/']) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
      }
    });

    await context.test('serves a real on-demand album lookup route', async () => {
      const response = await fetch(`${baseUrl}/api/albums/night-bus-radio.json`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        album: {
          slug: 'night-bus-radio',
          title: 'Night Bus Radio',
          artist: 'The Meridian Lines',
          year: 1983,
          format: 'LP',
          summary: 'Lean post-punk recorded between the last train and the first morning bus.',
        },
      });

      const missingResponse = await fetch(`${baseUrl}/api/albums/not-filed.json`);
      assert.equal(missingResponse.status, 404);
      assert.deepEqual(await missingResponse.json(), {
        error: {
          code: 'album_not_found',
          message: 'No album is filed as not-filed.',
        },
      });
    });

    await context.test('proves a static file cannot fulfill a protocol POST', async () => {
      const staticGet = await fetch(`${baseUrl}/protocol-post-negative.json`);
      assert.equal(staticGet.status, 200);
      const staticPayload = await staticGet.json();
      assert.deepEqual(staticPayload, {
        kind: 'static-negative-case',
        message:
          'This file is inert sample content. It is not a protocol endpoint or an MCP server.',
      });

      const staticPost = await fetch(`${baseUrl}/protocol-post-negative.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      });
      assert.equal(staticPost.status, 200);
      const postPayload = await staticPost.json();
      assert.deepEqual(postPayload, staticPayload);
      assert.equal('jsonrpc' in postPayload, false);
      assert.equal('id' in postPayload, false);
      assert.equal('result' in postPayload, false);
      assert.equal('error' in postPayload, false);
    });
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${serverOutput}`, { cause: error });
  } finally {
    await stopServer(server);
  }
});
