import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverRoutes } from '../bin/discover-routes.mjs';

test('filesystem routers discover routes without executing or publishing their sources', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-route-scan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    ['astro', 'src/pages/notes/index.astro', '/notes'],
    ['next', 'app/(lang)/items/[[...slug]]/page.tsx', '/items/[[...slug]]'],
    ['sveltekit', 'src/routes/(guide)/events/[id]/+page.svelte', '/events/[id]'],
    ['nuxt', 'app/pages/[lang]/index.vue', '/[lang]'],
  ];
  for (const [fw, file, expected] of cases) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'throw Error("SHOULD-NEVER-EXECUTE")');
    const found = await discoverRoutes(fw, root);
    assert.deepEqual(
      found.routes.map((x) => x.route),
      [expected],
    );
    assert.equal(found.routes[0].visibility, 'unknown');
    assert.equal(found.routes[0].requiresParameters, expected.includes('['));
    assert.ok(!JSON.stringify(found).includes('NEVER-EXECUTE'));
  }
});

test('native route tables keep dynamic paths unresolved and reject an outside source', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-table-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'routes.json'),
    JSON.stringify([{ path: 'line/:id', children: [{ path: 'stop/:slug' }] }, { path: '/about' }]),
  );
  for (const fw of ['react-vite', 'vue-vite', 'react-router', 'angular']) {
    const result = await discoverRoutes(fw, root, 'routes.json');
    assert.deepEqual(
      result.routes.map((x) => x.route),
      ['/about', '/line/:id', '/line/:id/stop/:slug'],
    );
    assert.equal(result.routes[2].requiresParameters, true);
  }
  await assert.rejects(discoverRoutes('angular', root, '../outside.json'), /unsafe-route-table/);
  await mkdir(path.join(root, 'dist'));
  await writeFile(
    path.join(root, 'dist/prerendered-routes.json'),
    JSON.stringify({ routes: { '/': {}, '/equipment/atlas-7': {} } }),
  );
  assert.equal((await discoverRoutes('angular', root)).routes.length, 2);
});
