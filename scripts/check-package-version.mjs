import { readFile } from 'node:fs/promises';

const packageManifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const versionSource = await readFile(new URL('../src/package-version.ts', import.meta.url), 'utf8');
const match = versionSource.match(/^export const PACKAGE_VERSION = '([^']+)';$/m);

if (match === null || match[1] !== packageManifest.version) {
  throw new Error(
    'src/package-version.ts must match package.json version ' + packageManifest.version,
  );
}
