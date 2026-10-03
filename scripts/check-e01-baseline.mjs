import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = path.join(repositoryRoot, 'examples/e01-album-catalog');
const beforeRoot = path.join(exampleRoot, 'site-before');
const projectRoot = path.join(exampleRoot, 'project');
const packageManagerCli = process.env.npm_execpath;
assert.ok(packageManagerCli, 'Run the baseline check through npm.');

function runNpm(args, cwd) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, `npm ${args.join(' ')} failed with exit code ${result.status}`);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const manifest = JSON.parse(
  await readFile(path.join(beforeRoot, 'baseline-manifest.json'), 'utf8'),
);
for (const [relativePath, expected] of Object.entries(manifest)) {
  const actual = hash(await readFile(path.join(beforeRoot, relativePath)));
  assert.equal(actual, expected, `before-state changed: ${relativePath}`);
}

const unchangedPaths = [
  'src/layouts/SiteLayout.astro',
  'src/pages/index.astro',
  'src/pages/about.astro',
  'src/data/albums.mjs',
  'public/mark.svg',
  'public/site.css',
];
for (const relativePath of unchangedPaths) {
  const before = hash(await readFile(path.join(beforeRoot, relativePath)));
  const after = hash(await readFile(path.join(projectRoot, relativePath)));
  assert.equal(after, before, `pre-existing Astro file changed: ${relativePath}`);
}

const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'uan007-e01-before-'));
try {
  await cp(beforeRoot, buildRoot, { recursive: true });
  runNpm(['ci'], buildRoot);
  runNpm(['run', 'build'], buildRoot);

  const outputRoot = path.join(buildRoot, 'dist');
  const pages = await Promise.all(
    ['index.html', 'albums/index.html', 'about/index.html'].map((page) =>
      readFile(path.join(outputRoot, page), 'utf8'),
    ),
  );
  for (const html of pages) {
    assert.match(html, /href="\/">/);
    assert.match(html, /href="\/albums\//);
    assert.match(html, /href="\/about\//);
  }
  assert.match(pages[1], /First Light/);
  assert.match(pages[1], /Blue Hour/);
  assert.match(await readFile(path.join(outputRoot, 'site.css'), 'utf8'), /site-header/);
  assert.match(await readFile(path.join(outputRoot, 'mark.svg'), 'utf8'), /<svg/);
  await assert.rejects(readdir(path.join(outputRoot, 'server')));
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

process.stdout.write(
  'UAN-007 pre-integration baseline passed: static home, albums, about, navigation, data, CSS, and SVG verified.\n',
);
