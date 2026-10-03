import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleId = process.argv[2];
const supportedExamples = new Set([
  'e01-album-catalog',
  'e02-astro-on-demand-catalog',
  'e03-next-reading-list',
  'e12-shared-unit-converter',
  'e05-node-cli',
  'e06-browser-only-theme-controls',
  'e04-worker-sidecar',
  'e07-playlist-permissions',
  'e09-album-explorer',
]);
if (exampleId === undefined || !supportedExamples.has(exampleId)) {
  throw new Error(
    'Choose a supported example id: e01-album-catalog, e02-astro-on-demand-catalog, e03-next-reading-list, e12-shared-unit-converter, e05-node-cli, e06-browser-only-theme-controls, e04-worker-sidecar, e07-playlist-permissions or e09-album-explorer.',
  );
}

const projectSource = path.join(repositoryRoot, 'examples', exampleId, 'project');
const exportRoot = path.join(repositoryRoot, 'examples', exampleId, '.exported');
const vendorRoot = path.join(exportRoot, 'vendor');
if (path.dirname(exportRoot) !== path.join(repositoryRoot, 'examples', exampleId)) {
  throw new Error('Refusing to export outside the selected example directory.');
}
const packageManifest = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
const archiveName = `${packageManifest.name.slice(1).replace('/', '-')}-${packageManifest.version}.tgz`;
const packageManagerCli = process.env.npm_execpath;

if (packageManagerCli === undefined) {
  throw new Error('Run this example check through the repository npm script.');
}

function runNpm(args, cwd) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function copyProjectFiles(sourceRoot, targetRoot) {
  await mkdir(targetRoot, { recursive: true });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyProjectFiles(sourcePath, targetPath);
    } else if (entry.name !== 'package.template.json' && entry.name !== 'package-lock.json') {
      await copyFile(sourcePath, targetPath);
    }
  }
}

runNpm(['run', 'build'], repositoryRoot);
await rm(exportRoot, { recursive: true, force: true });
await mkdir(vendorRoot, { recursive: true });
runNpm(['pack', '--pack-destination', vendorRoot], repositoryRoot);
await copyProjectFiles(projectSource, exportRoot);
const sharedManifestPath = path.join(projectSource, 'shared-files.json');
try {
  const sharedFiles = JSON.parse(await readFile(sharedManifestPath, 'utf8'));
  for (const [target, source] of Object.entries(sharedFiles)) {
    const sourcePath = path.resolve(repositoryRoot, source);
    const targetPath = path.resolve(exportRoot, target);
    if (
      !sourcePath.startsWith(repositoryRoot + path.sep) ||
      !targetPath.startsWith(exportRoot + path.sep)
    )
      throw new Error('Shared example file escapes its root.');
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const packageTemplate = JSON.parse(
  await readFile(path.join(projectSource, 'package.template.json'), 'utf8'),
);
packageTemplate.dependencies['@uppercut-labs/agent-native'] = `file:./vendor/${archiveName}`;
await writeFile(
  path.join(exportRoot, 'package.json'),
  `${JSON.stringify(packageTemplate, null, 2)}\n`,
);

// Each pack has a new integrity hash, so generate the exported lockfile for this tarball.
runNpm(['install', '--package-lock-only', '--ignore-scripts'], exportRoot);
runNpm(['ci'], exportRoot);
if (exampleId !== 'e03-next-reading-list') runNpm(['test'], exportRoot);
if (exampleId === 'e04-worker-sidecar' || exampleId === 'e03-next-reading-list')
  runNpm(['run', 'verify'], exportRoot);
else runNpm(['start'], exportRoot);
process.stdout.write(`Standalone ${exampleId} installed and tested at ${exportRoot}\n`);
