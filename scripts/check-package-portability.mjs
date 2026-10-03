import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run check:portability.');

function run(args, cwd, npm = false) {
  const command = npm ? process.execPath : args[0];
  const argv = npm ? [npmCli, ...args] : args.slice(1);
  const result = spawnSync(command, argv, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${(npm ? 'npm ' : '') + args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`,
    );
  }
  return result.stdout;
}

async function fileBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await fileBytes(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-native-portability-'));
try {
  const pack = JSON.parse(
    run(['pack', '--json', '--pack-destination', temporaryRoot], repositoryRoot, true),
  )[0];
  assert.ok(pack, 'npm pack returned no archive');
  for (const file of pack.files) {
    assert.match(file.path, /^(?:dist\/|docs\/|LICENSE$|README\.md$|package\.json$)/);
  }
  const archivePath = path.join(temporaryRoot, pack.filename);
  const consumerRoot = path.join(temporaryRoot, 'core-browser-consumer');
  await mkdir(consumerRoot);
  await writeFile(
    path.join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'agent-native-portability-fixture', private: true, type: 'module' }),
  );
  run(
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archivePath],
    consumerRoot,
    true,
  );
  const modulesRoot = path.join(consumerRoot, 'node_modules');
  const manifest = JSON.parse(
    await readFile(path.join(modulesRoot, '@uppercut-labs/agent-native/package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.dependencies ?? {}, {});
  for (const dependency of [
    '@modelcontextprotocol/server',
    '@modelcontextprotocol/ext-apps',
    'astro',
    'zod',
  ]) {
    assert.equal(manifest.peerDependenciesMeta?.[dependency]?.optional, true);
    const installedPath = path.join(modulesRoot, ...dependency.split('/'));
    await assert.rejects(stat(installedPath), { code: 'ENOENT' });
  }
  for (const entry of Object.values(manifest.exports)) {
    for (const target of Object.values(entry)) {
      await stat(path.join(modulesRoot, '@uppercut-labs/agent-native', target));
    }
  }
  run(
    [
      process.execPath,
      '--input-type=module',
      '-e',
      "await import('@uppercut-labs/agent-native'); await import('@uppercut-labs/agent-native/browser');",
    ],
    consumerRoot,
  );
  const installedBytes = await fileBytes(modulesRoot);
  // A fresh Node 24 macOS pack measured 503,177 file bytes; this permits about 4x growth.
  assert.ok(installedBytes <= 2_000_000, `Core/browser install grew to ${installedBytes} bytes`);
  process.stdout.write(
    'Packed core/browser install passed: ' +
      pack.size +
      ' tarball bytes, ' +
      installedBytes +
      ' installed file bytes, no optional adapters.\n',
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
