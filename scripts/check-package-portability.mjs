import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

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
  const packedPaths = new Set(pack.files.map((file) => file.path));
  const brokenDocLinks = [];
  const repositoryBlobPrefix = 'https://github.com/uppercut-labs/agent-native/blob/main/';
  for (const file of pack.files.filter((entry) => entry.path.endsWith('.md'))) {
    const markdown = await readFile(path.join(repositoryRoot, file.path), 'utf8');
    if (/^\{\{source:/m.test(markdown)) {
      brokenDocLinks.push(`${file.path}: unexpanded source region in packed Markdown`);
    }
    marked.walkTokens(marked.lexer(markdown), (token) => {
      if (token.type !== 'link' && token.type !== 'image') return;
      const href = token.href;
      if (href.startsWith(repositoryBlobPrefix)) {
        const sourcePath = decodeURIComponent(
          href.slice(repositoryBlobPrefix.length).split('#', 1)[0],
        );
        if (!existsSync(path.join(repositoryRoot, sourcePath))) {
          brokenDocLinks.push(`${file.path}: missing repository source ${href}`);
        }
        return;
      }
      if (/^(?:https?:|mailto:|data:|#)/i.test(href)) return;
      const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), target));
      if (!packedPaths.has(resolved)) {
        brokenDocLinks.push(`${file.path}: ${href} targets unpacked ${resolved}`);
      }
    });
  }
  assert.deepEqual(
    brokenDocLinks,
    [],
    'Packed Markdown links must resolve inside the archive or to an existing repository source',
  );
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
      "await import('@uppercut-labs/agent-native'); await import('@uppercut-labs/agent-native/browser'); await import('@uppercut-labs/agent-native/harness'); await import('@uppercut-labs/agent-native/harness/mcp-bridge');",
    ],
    consumerRoot,
  );
  const smokePath = path.join(consumerRoot, 'packed-cli-smoke.mjs');
  await copyFile(path.join(repositoryRoot, 'test/fixtures/packed-cli-smoke.mjs'), smokePath);
  function runPackedCli(args, expectedStatus) {
    const started = performance.now();
    const result = spawnSync(process.execPath, [smokePath, ...args], {
      cwd: consumerRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, expectedStatus, result.stderr + result.stdout);
    return { stdout: result.stdout, stderr: result.stderr, elapsedMs: performance.now() - started };
  }
  const help = runPackedCli(['--help'], 0);
  assert.match(help.stdout, /greet/);
  const version = runPackedCli(['--version'], 0);
  assert.equal(version.stdout.trim(), `@uppercut-labs/agent-native ${manifest.version}`);
  const invoked = runPackedCli(['greet', '--mode', 'local', '--name', 'Portability'], 0);
  const result = JSON.parse(invoked.stdout);
  assert.equal(result.schemaVersion, 'uan.cli-result/v1');
  assert.equal(result.result.value.greeting, 'Hello, Portability!');
  assert.match(invoked.stderr, /target=local capability=smoke:greet@1/);
  const invalid = runPackedCli(['greet', '--mode', 'local'], 2);
  assert.equal(JSON.parse(invalid.stdout).result.reason, 'invalid-input');

  const installedBytes = await fileBytes(modulesRoot);
  // A fresh Node 24 macOS pack measured 503,177 file bytes; this permits about 4x growth.
  assert.ok(installedBytes <= 2_000_000, `Core/browser install grew to ${installedBytes} bytes`);
  process.stdout.write(
    'Packed core/browser install passed: ' +
      pack.size +
      ' tarball bytes, ' +
      installedBytes +
      ' installed file bytes, no optional adapters; packed CLI help/version/invoke/invalid passed (' +
      Math.round(invoked.elapsedMs) +
      ' ms local invocation).\n',
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
