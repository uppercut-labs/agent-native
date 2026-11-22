import assert from 'node:assert/strict';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePublication } from '../examples/readability/shared/publication.mjs';

const page = {
  id: 'a',
  revision: 'one',
  route: '/page',
  visibility: 'public',
  title: 'The offer',
  markdown: 'The public rate is 19.',
};
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'publication-files-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app');
  await mkdir(app);
  return {
    dir,
    app,
    run: (opts = {}) =>
      preparePublication({
        appDir: app,
        siteUrl: 'https://example.test',
        approvedRoutes: ['/page'],
        showcase: page,
        ...opts,
      }),
  };
}
const targets = [
  'generated/manifest.json',
  'generated/publication.json',
  'public/agent-native-witness.json',
];
const undeclaredProtocol = 'public/openapi.json';
for (const target of [...targets, undeclaredProtocol]) {
  test('fixture refuses a symlink at ' + target + ' before publishing', async (t) => {
    const { dir, app, run } = await fixture(t);
    const dest = path.join(app, target),
      victim = path.join(dir, 'keep');
    await writeFile(victim, 'keep my file');
    await mkdir(path.dirname(dest), { recursive: true });
    await symlink(victim, dest);
    await assert.rejects(run(), /Unsafe fixture file/);
    assert.equal(await readFile(victim, 'utf8'), 'keep my file');
    await assert.rejects(lstat(path.join(app, 'public', 'llms.txt')), { code: 'ENOENT' });
    await assert.rejects(lstat(path.join(app, 'generated', '.ownership')), { code: 'ENOENT' });
  });
  test('fixture preserves unowned regular ' + target, async (t) => {
    const { app, run } = await fixture(t);
    const dest = path.join(app, target);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, 'hand-authored');
    await assert.rejects(run(), /Unowned or modified/);
    assert.equal(await readFile(dest, 'utf8'), 'hand-authored');
  });
}
test('fixture rejects symlink directories, root aliases and an outside model', async (t) => {
  const { dir, app, run } = await fixture(t);
  const outside = path.join(dir, 'elsewhere');
  await mkdir(outside);
  for (const subdir of ['public', 'generated', 'generated/.ownership']) {
    const unsafe = path.join(app, subdir);
    await mkdir(path.dirname(unsafe), { recursive: true });
    await symlink(outside, unsafe, 'dir');
    await assert.rejects(run(), /Unsafe fixture directory/);
    await rm(unsafe);
  }
  await symlink(app, path.join(dir, 'alias'), 'dir');
  await assert.rejects(run({ appDir: path.join(dir, 'alias') }), /Unsafe fixture root/);
  for (const opts of [
    { assetDir: 'generated' },
    { assetDir: '../elsewhere' },
    { modelFile: 'public/leak.json' },
    { modelFile: 'generated/manifest.json' },
    { modelFile: 'generated/.ownership/x' },
  ]) {
    await assert.rejects(run(opts), /Overlapping or outside fixture paths/);
  }
});
test('owned rebuild replaces validated files, modified output blocks every update', async (t) => {
  const { app, run } = await fixture(t);
  await run();
  const files = targets.map((f) => path.join(app, f));
  let before = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  assert.ok(before[0].includes('/account/settings'));
  assert.ok(!before[1].includes('/account/settings'));
  assert.ok(!before[2].includes('/account/settings'));
  const updated = { ...page, revision: 'two', markdown: 'The public rate is 23.' };
  await run({ showcase: updated });
  const after = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  assert.ok(after.every((value, i) => value !== before[i]));
  await run({ showcase: updated });
  const publicAsset = path.join(app, 'public/llms-full.txt');
  const saved = await readFile(publicAsset, 'utf8');
  await writeFile(files[2], 'owner edit');
  await assert.rejects(run(), /Unowned or modified/);
  assert.equal(await readFile(publicAsset, 'utf8'), saved);
  assert.equal(await readFile(files[0], 'utf8'), after[0]);
  assert.equal(await readFile(files[2], 'utf8'), 'owner edit');
});
test('hard-link aliases cannot turn private fixture files into public files', async (t) => {
  const { app, run } = await fixture(t);
  await run();
  const manifest = path.join(app, 'generated/manifest.json');
  await link(manifest, path.join(app, 'public', 'leak'));
  const before = await readFile(manifest, 'utf8');
  await assert.rejects(run({ showcase: { ...page, revision: 'two' } }), /Unsafe fixture file/);
  assert.equal(await readFile(manifest, 'utf8'), before);
});

test('human pages survive opt-in and withdrawal without publishing disabled metadata', async (t) => {
  const { app, run } = await fixture(t);
  const before = await run({ enabled: false });
  assert.equal(before.publicationEnabled, false);
  assert.ok(before.pages.some((entry) => entry.id === page.id));
  assert.ok(before.pages.every((entry) => entry.mirror === null && entry.jsonld === null));
  await assert.rejects(readFile(path.join(app, 'public/llms.txt')), { code: 'ENOENT' });
  const active = await run({ enabled: true });
  assert.equal(active.publicationEnabled, true);
  assert.match(await readFile(path.join(app, 'public/llms.txt'), 'utf8'), /The offer/);
  const after = await run({ enabled: false });
  assert.deepEqual(after, before);
  for (const file of [
    'llms.txt',
    'llms-full.txt',
    'agent-native/page.md',
    'agent-native/page.jsonld',
  ]) {
    await assert.rejects(readFile(path.join(app, 'public', file)), { code: 'ENOENT' });
  }
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE-DRAFT|\/account\/settings/);
});

test('fixture serves an undeclared protocol description that publication never advertises', async (t) => {
  const { app, run } = await fixture(t);
  await run();
  const served = await readFile(path.join(app, undeclaredProtocol), 'utf8');
  assert.equal(
    served,
    await readFile(new URL('../examples/readability/shared/openapi.json', import.meta.url), 'utf8'),
  );
  assert.equal(JSON.parse(served).openapi, '3.1.0');
  const manifest = JSON.parse(await readFile(path.join(app, 'generated/manifest.json'), 'utf8'));
  assert.equal(manifest.config.protocols, undefined);
  const published = (await readdir(path.join(app, 'public'), { recursive: true })).filter((file) =>
    /\.(?:txt|md|jsonld)$/.test(file),
  );
  assert.ok(published.includes('llms.txt') && published.includes('llms-full.txt'));
  for (const file of published) {
    assert.doesNotMatch(await readFile(path.join(app, 'public', file), 'utf8'), /openapi/i, file);
  }
  assert.doesNotMatch(
    await readFile(path.join(app, 'generated/publication.json'), 'utf8'),
    /openapi/i,
  );
});

test('a journal from before the protocol description adopts it only when absent', async (t) => {
  const { app, run } = await fixture(t);
  await run();
  const journal = path.join(app, 'generated/.ownership/fixture-files.json');
  const legacy = JSON.parse(await readFile(journal, 'utf8'));
  delete legacy.files[undeclaredProtocol];
  const description = path.join(app, undeclaredProtocol);
  await writeFile(journal, JSON.stringify(legacy));
  await assert.rejects(run(), /Unowned or modified/);
  assert.ok((await readFile(description, 'utf8')).includes('openapi'));
  await rm(description);
  await writeFile(journal, JSON.stringify(legacy));
  await run();
  assert.ok(JSON.parse(await readFile(journal, 'utf8')).files[undeclaredProtocol]);
  legacy.files['public/unknown.json'] = legacy.files[targets[2]];
  await writeFile(journal, JSON.stringify(legacy));
  await assert.rejects(run(), /Invalid fixture ownership journal/);
});
