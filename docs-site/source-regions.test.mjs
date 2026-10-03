import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { expandSourceRegions } from './source-regions.mjs';

test('source regions expand tested example code and reject broken references', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-native-doc-source-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'examples', 'e01-fixture', 'project');
  const source = path.join(project, 'src', 'example.mjs');
  const page = path.join(root, 'docs', 'guide.md');
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(page), { recursive: true });
  await writeFile(source, '// docs:start demo\nconst answer = 42;\n// docs:end demo\n');

  const expanded = await expandSourceRegions(
    '{{source:examples/e01-fixture/project/src/example.mjs#demo}}',
    page,
    root,
  );
  assert.match(expanded, /~~~js\nconst answer = 42;\n~~~/);
  assert.match(expanded, /example\.mjs#L2/);
  const baked = `<!-- source:examples/e01-fixture/project/src/example.mjs#demo -->\n${expanded}\n<!-- /source -->`;
  assert.equal(await expandSourceRegions(baked, page, root), expanded);
  await assert.rejects(
    expandSourceRegions(baked.replace('const answer = 42;', 'const answer = 43;'), page, root),
    /baked source region drifted/,
  );
  await assert.rejects(
    expandSourceRegions(baked.replace('<!-- /source -->', ''), page, root),
    /missing baked source end marker/,
  );

  await assert.rejects(
    expandSourceRegions('{{source:../secret.mjs#demo}}', page, root),
    /invalid source region directive/,
  );
  await assert.rejects(
    expandSourceRegions(
      '{{source:examples/e01-fixture/project/src/example.mjs#missing}}',
      page,
      root,
    ),
    /one ordered, nonempty marker pair/,
  );
  await writeFile(
    source,
    '// docs:start demo\n// docs:start demo\nconst answer = 42;\n// docs:end demo\n',
  );
  await assert.rejects(
    expandSourceRegions('{{source:examples/e01-fixture/project/src/example.mjs#demo}}', page, root),
    /one ordered, nonempty marker pair/,
  );
  const outside = await mkdtemp(path.join(os.tmpdir(), 'agent-native-doc-outside-'));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'outside.mjs'), '// docs:start demo\n42\n// docs:end demo\n');
  await symlink(path.join(outside, 'outside.mjs'), path.join(project, 'outside.mjs'));
  await assert.rejects(
    expandSourceRegions('{{source:examples/e01-fixture/project/outside.mjs#demo}}', page, root),
    /source region must be a project file/,
  );
});
