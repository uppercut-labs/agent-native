import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

test('core and Astro consumers neither install nor import Next', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies?.next, undefined);
  assert.equal(manifest.devDependencies.next, undefined);
  assert.equal(manifest.peerDependencies.next, undefined);
  for (const relative of ['src/index.ts', 'src/astro.ts', 'src/core/registry.ts']) {
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.equal(/from ['"](?:next|\.\/next)/.test(source), false, relative);
  }
});
