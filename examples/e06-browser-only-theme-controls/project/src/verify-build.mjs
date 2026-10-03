import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await files(full)));
    else result.push(full);
  }
  return result;
}
const assets = await files('dist/assets');
assert.ok(assets.length > 0, 'Vite should emit browser assets');
for (const file of assets) {
  const content = await readFile(file, 'utf8');
  assert.equal(content.includes('SERVER_ONLY_SECRET_SENTINEL'), false);
  assert.equal(content.includes('@modelcontextprotocol/server'), false);
}
process.stdout.write('Browser bundle boundary passed for ' + assets.length + ' emitted assets.\n');
