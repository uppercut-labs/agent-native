import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { currentReference, renderReference } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('checked-in reference matches package exports and CLI parser', async () => {
  assert.equal(
    await readFile(path.join(root, 'docs', 'reference.md'), 'utf8'),
    await currentReference(),
  );
});

test('a new CLI switch option requires a reference update', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const source = await readFile(path.join(root, 'src', 'cli.ts'), 'utf8');
  const edited = source.replace("case 'mode':", "case 'new-option':\n      case 'mode':");
  assert.throws(() => renderReference(manifest, edited), /CLI parser options changed/);
});

test('changed CLI option bounds require a reference update', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const source = await readFile(path.join(root, 'src', 'cli.ts'), 'utf8');
  const edited = source.replace('parsed > 300_000', 'parsed > 100_000');
  assert.throws(() => renderReference(manifest, edited), /CLI option rules changed/);
});

test('missing exported adapter configuration fails reference generation', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const [cli, http, mcp, doctor] = await Promise.all(
    ['cli.ts', 'http.ts', 'mcp.ts', 'doctor.ts'].map((name) =>
      readFile(path.join(root, 'src', name), 'utf8'),
    ),
  );
  const edited = http.replace('export type HttpAdapterOptions', 'type HttpAdapterOptions');
  assert.throws(
    () => renderReference(manifest, cli, { http: edited, mcp, doctor }),
    /Missing exported configuration type src\/http.ts#HttpAdapterOptions/,
  );
});
