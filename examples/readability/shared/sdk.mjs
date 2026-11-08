import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CI installs a packed candidate in the example. In a source checkout use the built SDK.
export async function locateSdk(appDir) {
  if (appDir instanceof URL) appDir = fileURLToPath(appDir);
  const installed = path.join(appDir, 'node_modules/@uppercut-labs/agent-native');
  const sdk = existsSync(installed)
    ? installed
    : fileURLToPath(new URL('../../../', import.meta.url));
  const pkg = JSON.parse(await readFile(path.join(sdk, 'package.json'), 'utf8'));
  return { sdk, pkg };
}

export async function importPublication(appDir) {
  const { sdk, pkg } = await locateSdk(appDir);
  return import(pathToFileURL(path.join(sdk, pkg.exports['./publication'].import)).href);
}
