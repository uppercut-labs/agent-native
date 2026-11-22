// Run after a fixture's framework build: add the hashes of the client bundles the build emitted
// to the deployment witness, so a host or CDN that serves a stale script cannot pass an identity
// check. The witness stays owned by the fixture journal; the framework's output copy is refreshed.
// usage (from a fixture directory): node ../shared/finalize-witness.mjs <framework>
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { writeFixtureFiles } from './fixture-files.mjs';

// Client output directory, the URL prefix it is served under, and the directory that holds the
// framework's build-time copy of the public assets (null when public files are served live).
// Nuxt and SvelteKit run this inside their builds: Nitro and the SvelteKit Node adapter record each
// public file's size (and precompress it) when they package the server, so the witness must be
// final before then. Nuxt uses its `nitro:build:public-assets` hook; SvelteKit wraps the adapter.
export const clientOutputs = {
  astro: { dir: 'dist/client', prefix: '/', copy: 'dist/client' },
  next: { dir: '.next/static', prefix: '/_next/static/', copy: null },
  'react-vite': { dir: 'dist', prefix: '/', copy: 'dist' },
  'vue-vite': { dir: 'dist', prefix: '/', copy: 'dist' },
  sveltekit: {
    dir: '.svelte-kit/output/client',
    prefix: '/',
    copy: '.svelte-kit/output/client',
    assetDir: 'static',
  },
  nuxt: { dir: '.output/public', prefix: '/', copy: '.output/public' },
  'react-router': { dir: 'build/client', prefix: '/', copy: 'build/client' },
  angular: { dir: 'dist/browser', prefix: '/', copy: 'dist/browser' },
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Served path → SHA-256 of every JavaScript file under a client output directory. */
export async function hashBundles(dir, prefix = '/') {
  const bundles = {};
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
        const served = prefix + path.relative(dir, file).split(path.sep).join('/');
        bundles[served] = sha256(await readFile(file));
      }
    }
  }
  await walk(dir);
  return Object.fromEntries(Object.entries(bundles).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export async function finalizeWitness(appDir, framework) {
  const output = clientOutputs[framework];
  if (!output) throw Error('Unknown fixture framework');
  const assetDir = output.assetDir ?? 'public';
  const read = (file) => readFile(path.join(appDir, file));
  const witnessFile = path.join(assetDir, 'agent-native-witness.json');
  const { bundles: _previous, ...identity } = JSON.parse(await read(witnessFile));
  const bundles = await hashBundles(path.join(appDir, output.dir), output.prefix);
  const witness = JSON.stringify({ ...identity, bundles }) + '\n';
  const publicFiles = {};
  for (const name of ['openapi.json'])
    if (existsSync(path.join(appDir, assetDir, name)))
      publicFiles[name] = await read(path.join(assetDir, name));
  // The journal requires every owned output; rewrite them with their current bytes.
  await writeFixtureFiles({
    appDir,
    assetDir,
    modelFile: 'generated/publication.json',
    input: await read('generated/manifest.json'),
    model: await read('generated/publication.json'),
    witness,
    publicFiles,
    publish: async () => {},
  });
  if (output.copy) {
    const copy = path.join(appDir, output.copy, 'agent-native-witness.json');
    if (!existsSync(path.dirname(copy))) throw Error('Run the framework build first');
    await copyFile(path.join(appDir, witnessFile), copy);
    // Hosts that precompress assets (SvelteKit's Node adapter) would otherwise serve the old bytes.
    if (existsSync(copy + '.gz')) await writeFile(copy + '.gz', gzipSync(witness));
    if (existsSync(copy + '.br')) await writeFile(copy + '.br', brotliCompressSync(witness));
  }
  return { bundles: Object.keys(bundles).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await finalizeWitness(process.cwd(), process.argv[2]);
  console.log(`agent-native-witness.json: ${result.bundles} client bundles`);
}
