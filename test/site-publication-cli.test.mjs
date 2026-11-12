import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/agent-native-site.mjs', import.meta.url));
const example = fileURLToPath(new URL('../examples/site-publication/build.mjs', import.meta.url));
async function fixture(t, origin = 'https://example.test/') {
  const dir = await mkdtemp(path.join(tmpdir(), 'an-site-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  await run(process.execPath, [example, dir, origin]);
  const out = path.join(dir, 'public'),
    state = path.join(dir, 'state'),
    manifest = path.join(dir, 'site.json');
  async function command(name, digest, overrides = []) {
    let stdout;
    try {
      ({ stdout } = await run(process.execPath, [
        cli,
        name,
        '--manifest',
        manifest,
        '--out',
        out,
        '--state',
        state,
        ...(digest ? ['--approve', digest] : []),
        ...overrides,
      ]));
    } catch (e) {
      stdout = e.stdout;
    }
    return JSON.parse(stdout);
  }
  return { out, state, manifest, command };
}

test('preview, exact approval, idempotence, update, withdrawal and restoration', async (t) => {
  const { out, state, manifest, command } = await fixture(t);
  const first = await command('preview');
  assert.equal(first.status, 'preview');
  assert.deepEqual(await readdir(state), []);
  assert.deepEqual(await readdir(out), ['events']);
  assert.equal((await command('apply')).code, 'approval-required');
  assert.equal((await command('apply', 'wrong')).code, 'stale-approval');
  assert.equal((await command('apply', first.digest)).status, 'applied');
  const same = await command('preview');
  assert.deepEqual(same.changes, []);
  assert.equal((await command('apply', same.digest)).status, 'no-op');
  const material = JSON.parse(await readFile(manifest, 'utf8'));
  material.candidates[0].markdown = 'Doors open at noon.';
  await writeFile(manifest, JSON.stringify(material));
  assert.equal((await command('apply', same.digest)).code, 'stale-approval');
  const change = await command('preview');
  assert.equal((await command('apply', change.digest)).status, 'applied');
  assert.match(await readFile(path.join(out, 'llms-full.txt'), 'utf8'), /at noon/);
  material.candidates[0].visibility = 'private';
  material.config.full = false;
  await writeFile(manifest, JSON.stringify(material));
  const revoke = await command('preview');
  assert.equal((await command('apply', revoke.digest)).status, 'applied');
  await assert.rejects(readFile(path.join(out, 'llms-full.txt')), { code: 'ENOENT' });
  assert.doesNotMatch(await readFile(path.join(out, 'llms.txt'), 'utf8'), /Lantern/);
  const revert = await command('restore-preview');
  assert.equal((await command('restore', revert.digest)).status, 'restored');
  await assert.rejects(readFile(path.join(out, 'llms.txt')), { code: 'ENOENT' });
  assert.match(await readFile(path.join(out, 'events/lantern/index.html'), 'utf8'), /Lantern/);
});

test('collision, post-review user edit, and unsafe roots cannot mutate human files', async (t) => {
  const { out, state, command } = await fixture(t);
  await writeFile(path.join(out, 'llms.txt'), 'human');
  assert.deepEqual((await command('preview')).conflicts, ['llms.txt']);
  assert.equal((await command('apply', 'wrong')).code, 'ownership-conflict');
  assert.equal(await readFile(path.join(out, 'llms.txt'), 'utf8'), 'human');
  await rm(path.join(out, 'llms.txt'));
  const preview = await command('preview');
  await command('apply', preview.digest);
  const restore = await command('restore-preview');
  await writeFile(path.join(out, 'llms.txt'), 'edited');
  assert.equal((await command('restore', restore.digest)).code, 'ownership-conflict');
  assert.equal(await readFile(path.join(out, 'llms.txt'), 'utf8'), 'edited');
  assert.equal((await command('preview', undefined, ['--out', state])).code, 'invalid-roots');
});

test('a symlink in a destination component cannot redirect writes', async (t) => {
  // Creating a symlink on Windows may require developer mode or an elevated session.
  const { out, state, command } = await fixture(t);
  try {
    await symlink(state, path.join(out, 'agent-native'), 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('symlink creation unavailable');
      return;
    }
    throw error;
  }
  assert.equal((await command('preview')).code, 'unsafe-path');
  assert.deepEqual(await readdir(state), []);
});

test('HTTP verifier detects a fallback shell, changed bytes and incorrect canonical', async (t) => {
  let serve;
  const server = createServer((req, res) => serve(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const { out, command } = await fixture(t, origin);
  const preview = await command('preview');
  await command('apply', preview.digest);
  let fallback = false;
  serve = async (req, res) => {
    let url = new URL(req.url, origin).pathname;
    if (url.endsWith('/')) url += 'index.html';
    try {
      const bytes = await readFile(path.join(out, url));
      const type = url.endsWith('.md')
        ? 'text/markdown'
        : url.endsWith('.jsonld')
          ? 'application/ld+json'
          : url.endsWith('.html')
            ? 'text/html'
            : 'text/plain';
      res.writeHead(200, { 'content-type': type });
      res.end(bytes);
    } catch {
      res.writeHead(fallback ? 200 : 404, { 'content-type': 'text/html' });
      res.end('<html></html>');
    }
  };
  const green = await command('verify');
  assert.equal(green.status, 'verified', JSON.stringify(green));
  fallback = true;
  await writeFile(path.join(out, 'llms.txt'), 'stale');
  await writeFile(
    path.join(out, 'events/lantern/index.html'),
    '<html><head><link rel="canonical" href="/other"></head></html>',
  );
  const red = await command('verify');
  assert.deepEqual(
    red.checks
      .filter((x) => !x.pass)
      .map((x) => x.test)
      .sort(),
    ['human-page', 'missing-mirror', 'published-bytes'],
  );
});

test('a failed journal commit rolls back published bytes and releases private state', async (t) => {
  const { out, state, manifest, command } = await fixture(t);
  const preview = await command('preview');
  await command('apply', preview.digest);
  const beforeIndex = await readFile(path.join(out, 'llms-full.txt'), 'utf8');
  const beforeJournal = await readFile(path.join(state, 'ownership.json'), 'utf8');
  const changed = JSON.parse(await readFile(manifest, 'utf8'));
  changed.candidates[0].markdown = 'A new fact to roll back.';
  await writeFile(manifest, JSON.stringify(changed));
  const approved = await command('preview');
  const hook = path.join(state, 'fault.mjs');
  await writeFile(
    hook,
    `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; fs.rename=async()=>{throw Object.assign(new Error('injected'),{code:'EIO'})}; syncBuiltinESMExports();`,
  );
  await assert.rejects(
    run(process.execPath, [
      '--import',
      hook,
      cli,
      'apply',
      '--manifest',
      manifest,
      '--out',
      out,
      '--state',
      state,
      '--approve',
      approved.digest,
    ]),
    (e) => JSON.parse(e.stdout).code === 'EIO',
  );
  assert.equal(await readFile(path.join(out, 'llms-full.txt'), 'utf8'), beforeIndex);
  assert.equal(await readFile(path.join(state, 'ownership.json'), 'utf8'), beforeJournal);
  assert.deepEqual((await readdir(state)).sort(), ['fault.mjs', 'ownership.json']);
});
