import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { finalizeWitness, hashBundles } from '../examples/readability/shared/finalize-witness.mjs';
import { preparePublication } from '../examples/readability/shared/publication.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const page = {
  id: 'a',
  revision: 'one',
  route: '/page',
  visibility: 'public',
  title: 'The offer',
  markdown: 'The public rate is 19.',
  facts: [{ label: 'Public rate', value: '19' }],
};

async function app(t) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'witness-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'app');
  await mkdir(root);
  const prepare = () =>
    preparePublication({
      appDir: root,
      siteUrl: 'https://example.test',
      approvedRoutes: ['/page'],
      showcase: page,
    });
  return { root, prepare };
}

test('bundle hashes cover every served script under the client output', async (t) => {
  const { root } = await app(t);
  const dir = path.join(root, '.next/static');
  await mkdir(path.join(dir, 'chunks/app'), { recursive: true });
  await writeFile(path.join(dir, 'chunks/app/page-1a2b3c.js'), 'one');
  await writeFile(path.join(dir, 'chunks/main-9f8e.mjs'), 'two');
  await writeFile(path.join(dir, 'chunks/style-77.css'), 'three');
  assert.deepEqual(await hashBundles(dir, '/_next/static/'), {
    '/_next/static/chunks/app/page-1a2b3c.js': sha256('one'),
    '/_next/static/chunks/main-9f8e.mjs': sha256('two'),
  });
});

test('the witness gains bundle hashes through the fixture journal', async (t) => {
  const { root, prepare } = await app(t);
  const projection = await prepare();
  assert.deepEqual(projection.pages[0].facts, page.facts);
  const witnessFile = path.join(root, 'public/agent-native-witness.json');
  const before = JSON.parse(await readFile(witnessFile, 'utf8'));
  assert.deepEqual(Object.keys(before), ['version', 'edition', 'proofCodeHash', 'projectionHash']);
  // A Vite-style build copies public files into its output beside the hashed bundles.
  const dist = path.join(root, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'assets/index-Ab12Cd34.js'), 'console.log(1)');
  await copyFile(witnessFile, path.join(dist, 'agent-native-witness.json'));

  assert.deepEqual(await finalizeWitness(root, 'react-vite'), { bundles: 1 });
  const bytes = await readFile(witnessFile, 'utf8');
  assert.deepEqual(JSON.parse(bytes), {
    ...before,
    bundles: { '/assets/index-Ab12Cd34.js': sha256('console.log(1)') },
  });
  assert.equal(await readFile(path.join(dist, 'agent-native-witness.json'), 'utf8'), bytes);

  // The next build's prepare step still owns the file, and finalizing again tracks new bundles.
  await prepare();
  await writeFile(path.join(dist, 'assets/index-Ab12Cd34.js'), 'console.log(2)');
  await finalizeWitness(root, 'react-vite');
  assert.equal(
    JSON.parse(await readFile(witnessFile, 'utf8')).bundles['/assets/index-Ab12Cd34.js'],
    sha256('console.log(2)'),
  );

  // An edited witness is not owned by the journal and is never overwritten.
  await writeFile(witnessFile, '{}\n');
  await assert.rejects(finalizeWitness(root, 'react-vite'), /Unowned or modified fixture file/);
});

test('a script-free build records an empty bundle set and refreshes precompressed copies', async (t) => {
  const { root, prepare } = await app(t);
  await prepare();
  await assert.rejects(finalizeWitness(root, 'gatsby'), /Unknown fixture framework/);
  const client = path.join(root, 'build/client');
  await mkdir(client, { recursive: true });
  await assert.rejects(finalizeWitness(root, 'sveltekit'), /ENOENT/);
  const dist = path.join(root, 'dist');
  await mkdir(dist);
  await assert.rejects(finalizeWitness(root, 'astro'), /ENOENT|Run the framework build first/);
  await mkdir(path.join(root, 'dist/client'));
  const copy = path.join(root, 'dist/client/agent-native-witness.json');
  await writeFile(copy + '.gz', 'stale');
  await writeFile(copy + '.br', 'stale');
  assert.deepEqual(await finalizeWitness(root, 'astro'), { bundles: 0 });
  const bytes = await readFile(copy);
  assert.deepEqual(JSON.parse(bytes).bundles, {});
  assert.deepEqual(gunzipSync(await readFile(copy + '.gz')), bytes);
  assert.deepEqual(brotliDecompressSync(await readFile(copy + '.br')), bytes);
});
