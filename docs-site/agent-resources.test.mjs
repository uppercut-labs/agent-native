import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateAgentResources } from './agent-resources.mjs';

const root = path.resolve(import.meta.dirname, '..');
test('agent resources validate actual public sources and reject damaged handoffs', async () => {
  assert.deepEqual(await validateAgentResources(root), []);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'agent-resources-'));
  try {
    for (const file of ['skill', 'agent', 'docs', 'examples', 'package.json']) {
      await cp(path.join(root, file), path.join(temp, file), { recursive: true });
    }
    const skill = path.join(temp, 'skill/agent-native/SKILL.md');
    const original = await readFile(skill, 'utf8');
    for (const [before, after, expected] of [
      ['name: agent-native', 'name: other', 'YAML name'],
      [/description: .+/, 'description:', 'YAML description'],
      ['references/verification.md', 'references/missing.md', 'broken or escaping reference'],
    ]) {
      await writeFile(skill, original.replace(before, after));
      assert.ok((await validateAgentResources(temp)).some((failure) => failure.includes(expected)));
    }
    await writeFile(skill, original);
    await rm(path.join(temp, 'skill/agent-native/references/verification.md'));
    assert.ok(
      (await validateAgentResources(temp)).some((failure) => failure.includes('missing resource')),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
