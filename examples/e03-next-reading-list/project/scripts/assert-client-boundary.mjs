import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(fixtureRoot, '.next', 'server');
const staticRoot = path.join(fixtureRoot, '.next', 'static');
const sentinel = 'FAKE_E03_SERVER_SENTINEL_NOT_A_REAL_SECRET_7f3c91';
const serverFiles = await walk(serverRoot);
const serverArtifacts = serverFiles.filter((file) => file.endsWith('.js') || file.endsWith('.map'));
const clientFiles = await walk(staticRoot);
const browserArtifacts = clientFiles.filter(
  (file) => file.endsWith('.js') || file.endsWith('.map'),
);
const sourceMaps = browserArtifacts.filter((file) => file.endsWith('.map'));

assert.ok(
  serverArtifacts.some((file) => file.endsWith('.js')),
  'expected emitted server JavaScript',
);
assert.ok(
  browserArtifacts.some((file) => file.endsWith('.js')),
  'expected emitted browser JavaScript',
);
assert.ok(sourceMaps.length > 0, 'expected production browser source maps to inspect');

const serverMatches = await filesContaining(serverArtifacts, sentinel);
assert.ok(serverMatches.length > 0, 'expected server-only sentinel in an emitted server artifact');
const clientMatches = await filesContaining(browserArtifacts, sentinel);
assert.deepEqual(
  clientMatches,
  [],
  `server-only sentinel leaked into browser artifacts: ${clientMatches.join(', ')}`,
);
console.log(
  `server boundary: sentinel present in ${serverMatches.length} server artifacts and absent from ${browserArtifacts.length} browser artifacts (${sourceMaps.length} source maps)`,
);

async function filesContaining(files, value) {
  const matches = [];
  for (const file of files) {
    if ((await readFile(file, 'utf8')).includes(value))
      matches.push(path.relative(fixtureRoot, file));
  }
  return matches;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}
