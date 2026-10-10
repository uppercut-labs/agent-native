import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-run every exported example from a temporary directory outside this repository so that no
// parent node_modules or workspace path can satisfy a dependency the export forgot to declare.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageManagerCli = process.env.npm_execpath;
if (packageManagerCli === undefined) {
  throw new Error('Run this check through the repository npm script.');
}

// Mirrors the post-install commands in scripts/check-example.mjs.
const commands = {
  'e01-album-catalog': [['test'], ['start']],
  'e02-astro-on-demand-catalog': [['test'], ['start']],
  'e03-next-reading-list': [['run', 'verify']],
  'e04-worker-sidecar': [['test'], ['run', 'verify']],
  'e05-node-cli': [['test'], ['start']],
  'e06-browser-only-theme-controls': [['test'], ['start']],
  'e07-playlist-permissions': [['test'], ['start']],
  'e08-reusable-versioned-pack': [['test'], ['start']],
  'e09-album-explorer': [['test'], ['start']],
  'e10-existing-functions-retrofit': [
    ['test'],
    ['run', 'search', '--', '--query', 'night', '--limit', '1'],
  ],
  'e11-diagnostics-fault-lab': [['test'], ['start']],
  'e12-shared-unit-converter': [['test'], ['start']],
};
const skipped = new Set(['node_modules', 'dist', '.astro', '.next', '.worker-bundle', '.wrangler']);
const requested = process.argv.slice(2);
const exampleIds = requested.length > 0 ? requested : Object.keys(commands);

function runNpm(args, cwd) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status} in ${cwd}`);
  }
}

function assertNoAncestorModules(directory) {
  for (let current = path.dirname(directory); ; current = path.dirname(current)) {
    if (existsSync(path.join(current, 'node_modules'))) {
      throw new Error(`Isolation broken: ${current} contains node_modules.`);
    }
    if (path.dirname(current) === current) return;
  }
}

for (const exampleId of exampleIds) {
  const steps = commands[exampleId];
  if (steps === undefined) throw new Error(`Unknown example id: ${exampleId}`);
  const exported = path.join(repositoryRoot, 'examples', exampleId, '.exported');
  if (!existsSync(path.join(exported, 'package-lock.json'))) {
    throw new Error(`Run npm run example:${exampleId.slice(0, 3)} before the isolated check.`);
  }
  const target = await realpath(await mkdtemp(path.join(tmpdir(), `uan-${exampleId}-`)));
  try {
    if (target.startsWith(repositoryRoot + path.sep)) {
      throw new Error('Temporary directory is inside the repository.');
    }
    assertNoAncestorModules(target);
    for (const entry of await readdir(exported)) {
      if (skipped.has(entry)) continue;
      await cp(path.join(exported, entry), path.join(target, entry), { recursive: true });
    }
    runNpm(['ci'], target);
    const resolved = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "process.stdout.write(import.meta.resolve('@uppercut-labs/agent-native'))",
      ],
      { cwd: target, encoding: 'utf8' },
    );
    const resolvedPath = await realpath(fileURLToPath(resolved.stdout));
    if (!resolvedPath.startsWith(path.join(target, 'node_modules') + path.sep)) {
      throw new Error(`${exampleId} resolved the package outside its project: ${resolvedPath}`);
    }
    for (const step of steps) runNpm(step, target);
    process.stdout.write(`Isolated ${exampleId} installed and tested outside the repository.\n`);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}
process.stdout.write(`Isolated export check passed for ${exampleIds.length} example(s).\n`);
