import { readFile } from 'node:fs/promises';

const packageManifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const versionSource = await readFile(new URL('../src/package-version.ts', import.meta.url), 'utf8');
const match = versionSource.match(/^export const PACKAGE_VERSION = '([^']+)';$/m);

if (match === null || match[1] !== packageManifest.version) {
  throw new Error(
    `src/package-version.ts must match package.json version ${packageManifest.version}`,
  );
}

const e08ContractManifest = JSON.parse(
  await readFile(
    new URL(
      '../examples/e08-reusable-versioned-pack/project/contracts/package.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
if (e08ContractManifest.peerDependencies?.[packageManifest.name] !== packageManifest.version) {
  throw new Error('E08 contract peer must match package.json version');
}
