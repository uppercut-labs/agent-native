import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
runNpm(['run', 'build'], repositoryRoot);

const retrofitRoot = await mkdtemp(path.join(os.tmpdir(), 'uan-init-retrofit with spaces-'));
try {
  await cp(beforeRoot, retrofitRoot, { recursive: true });
  const originalLock = JSON.parse(
    await readFile(path.join(retrofitRoot, 'package-lock.json'), 'utf8'),
  );
  await writeFile(
    path.join(retrofitRoot, 'src/private-unselected.mjs'),
    "throw new Error('app module must not be imported during detection');\n",
  );
  const vendor = path.join(retrofitRoot, 'vendor');
  await mkdir(vendor);
  runNpm(['pack', '--silent', '--pack-destination', vendor], repositoryRoot);
  const archive = (await readdir(vendor)).find((name) => name.endsWith('.tgz'));
  assert.ok(archive, 'local tarball was created');
  runNpm(
    [
      'install',
      '--save-exact',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(vendor, archive),
    ],
    retrofitRoot,
  );

  const { createInitPlan, applyInitPlan } = await import('../dist/init.js');
  const choices = {
    hosting: 'cloudflare',
    sidecarOrigin: 'https://albums.example.workers.dev',
    routeMode: 'sidecar',
  };
  const plan = await createInitPlan(retrofitRoot, {}, choices);
  assert.equal(plan.detection.applicationRoot, '');
  assert.equal(plan.detection.framework, 'astro');
  assert.equal(plan.detection.rendering, 'static');
  assert.match(plan.manualIntegration, /recognized literal static template/);
  assert.ok(plan.proposedFiles.includes('astro.config.mjs'));
  assert.ok(plan.proposedFiles.includes('.agent-native/browser-entry.mjs'));
  const result = await applyInitPlan(retrofitRoot, plan, choices, { approved: true });
  assert.equal(result.status, 'applied');
  runNpm(['run', 'build'], retrofitRoot);

  const outputRoot = path.join(retrofitRoot, 'dist');
  const pages = await Promise.all(
    ['index.html', 'albums/index.html', 'about/index.html'].map((page) =>
      readFile(path.join(outputRoot, page), 'utf8'),
    ),
  );
  assert.match(pages[1], /First Light/);
  assert.match(pages[1], /href="\/about\//);
  await assert.rejects(readdir(path.join(outputRoot, 'server')));
  const chunks = (await readdir(path.join(outputRoot, '_astro'))).filter((name) =>
    name.endsWith('.js'),
  );
  assert.ok(chunks.length > 0, 'Astro emitted a browser JavaScript entry');
  const javascript = (
    await Promise.all(chunks.map((name) => readFile(path.join(outputRoot, '_astro', name), 'utf8')))
  ).join('\\n');
  assert.match(javascript, /agent-native:ready/);
  assert.match(javascript, /albums\.example\.workers\.dev/);

  const updatedLock = JSON.parse(
    await readFile(path.join(retrofitRoot, 'package-lock.json'), 'utf8'),
  );
  for (const [name, value] of Object.entries(originalLock.packages)) {
    if (name !== '')
      assert.deepEqual(updatedLock.packages[name], value, `unrelated lock entry changed: ${name}`);
  }
} finally {
  await rm(retrofitRoot, { recursive: true, force: true });
}
