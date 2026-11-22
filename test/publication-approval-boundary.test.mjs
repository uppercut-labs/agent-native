import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { planPublication } from '../dist/publication.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/agent-native-site.mjs', import.meta.url));
const config = {
  enabled: true,
  siteUrl: 'https://example.test/',
  title: 'Public workshop',
  description: 'Approved workshop information.',
};
const publicSource = {
  id: 'workshop',
  revision: 'r1',
  route: '/workshops/lantern',
  visibility: 'public',
  title: 'Lantern workshop',
  markdown: 'Doors open at 10:30.',
};
const restrictedSources = ['unknown', 'draft', 'authenticated'].map((visibility) => ({
  id: visibility,
  revision: 'r1',
  route: visibility === 'unknown' ? '/workshops/[slug]' : `/${visibility}/PRIVATE_ROUTE_MARKER`,
  visibility,
  title: 'PRIVATE_TITLE_MARKER',
  markdown: 'PRIVATE_BODY_MARKER',
}));

/** @param {string} root @returns {Promise<readonly string[]>} */
async function inventory(root) {
  let result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(`${entry.name}/`);
      result.push(...(await inventory(file)).map((row) => `${entry.name}/${row}`));
    } else {
      result.push(
        `${entry.name}:${createHash('sha256')
          .update(await readFile(file))
          .digest('hex')}`,
      );
    }
  }
  return result;
}

test('mixed visibility and ambiguous canonicals never reveal excluded projections', async () => {
  const sources = [publicSource, ...restrictedSources];
  const plan = await planPublication(config, sources);
  assert.equal(plan.manifest.entries.filter((entry) => entry.status === 'included').length, 1);
  assert.equal(plan.manifest.entries.filter((entry) => entry.status === 'excluded').length, 3);
  assert.equal(plan.diagnostics[0].code, 'review-visibility');
  assert.doesNotMatch(JSON.stringify(plan), /PRIVATE_|\[slug\]/);
  assert.match(JSON.stringify(plan.assets), /Doors open at 10:30/);

  const collision = await planPublication(config, [
    ...sources,
    { ...publicSource, id: 'duplicate', route: '/WORKSHOPS/lantern/' },
  ]);
  assert.ok(collision.diagnostics.some((diagnostic) => diagnostic.code === 'route-collision'));
  assert.deepEqual(collision.assets, []);
  const privateLocator = await planPublication(config, [
    { ...publicSource, id: '/private/PRIVATE_SOURCE_MARKER' },
  ]);
  assert.equal(privateLocator.diagnostics[0].code, 'invalid-source');
  assert.doesNotMatch(JSON.stringify(privateLocator), /PRIVATE_SOURCE_MARKER/);
});

test('review is read-only and approval cannot move destination or broaden the public selection', async (t) => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'publication-approval-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'public');
  const otherOut = path.join(root, 'other-public');
  const state = path.join(root, 'state');
  const manifest = path.join(root, 'manifest.json');
  await Promise.all([mkdir(out), mkdir(otherOut), mkdir(state)]);
  await writeFile(path.join(out, 'human.html'), 'Keep the human route.');
  const original = { config, candidates: [publicSource, ...restrictedSources] };
  await writeFile(manifest, JSON.stringify(original));
  const before = await inventory(root);
  const args = ['--manifest', manifest, '--state', state, '--out', out];
  const preview = JSON.parse((await run(process.execPath, [cli, 'preview', ...args])).stdout);
  assert.equal(preview.status, 'preview');
  assert.deepEqual(await inventory(root), before);

  await assert.rejects(
    run(process.execPath, [cli, 'apply', ...args, '--out', otherOut, '--approve', preview.digest]),
    (error) => error.code === 1 && JSON.parse(error.stdout).code === 'stale-approval',
  );
  assert.deepEqual(await inventory(root), before);

  const mutations = [
    { ...original, config: { ...config, siteUrl: 'https://other.test/' } },
    { ...original, candidates: [{ ...publicSource, markdown: 'New public field.' }] },
    {
      ...original,
      candidates: [
        ...original.candidates,
        { ...publicSource, id: 'added', route: '/workshops/new' },
      ],
    },
  ];
  for (const changed of mutations) {
    await writeFile(manifest, JSON.stringify(changed));
    const beforeAttempt = await inventory(root);
    await assert.rejects(
      run(process.execPath, [cli, 'apply', ...args, '--approve', preview.digest]),
      (error) => error.code === 1 && JSON.parse(error.stdout).code === 'stale-approval',
    );
    assert.deepEqual(await inventory(root), beforeAttempt);
  }
  await writeFile(
    manifest,
    JSON.stringify({ ...original, candidates: [{ ...publicSource, route: '/../private' }] }),
  );
  const beforeUnsafe = await inventory(root);
  await assert.rejects(
    run(process.execPath, [cli, 'preview', ...args]),
    (error) => error.code === 1 && JSON.parse(error.stdout).detail[0].code === 'unsafe-route',
  );
  assert.deepEqual(await inventory(root), beforeUnsafe);
});
