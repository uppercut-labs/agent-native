import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCoverage } from './coverage-check.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(repositoryRoot, 'docs-site', 'coverage.json'), 'utf8'),
);

test('all twelve examples have source, docs, CI, and negative-path coverage', async () => {
  assert.deepEqual(await validateCoverage(repositoryRoot, manifest), []);
});

test('stale script, source, evidence, and negative test probes fail coverage', async () => {
  const stale = structuredClone(manifest);
  stale.examples[0].script = 'example:e99';
  stale.examples[1].source = `${stale.examples[1].project}/src/missing.mjs`;
  stale.examples[2].evidence = 'docs/evidence/UAN-999-missing.md';
  stale.examples[3].negative.probe = 'a removed negative case';
  stale.examples[4].requirements = [];
  stale.examples[5].source = `${stale.examples[5].project}/src/main.js`;
  const failures = await validateCoverage(repositoryRoot, stale);
  assert.ok(failures.some((failure) => failure.includes('E01: invalid example script')));
  assert.ok(failures.some((failure) => failure.includes('E02 source: missing file')));
  assert.ok(failures.some((failure) => failure.includes('E03 evidence: missing file')));
  assert.ok(failures.some((failure) => failure.includes('E04: negative probe is missing')));
  assert.ok(failures.some((failure) => failure.includes('E05: invalid requirement coverage')));
  assert.ok(
    failures.some((failure) => failure.includes('E06: guide has no source-backed snippet')),
  );
});

test('omitting an example fails coverage', async () => {
  const incomplete = structuredClone(manifest);
  incomplete.examples.pop();
  const failures = await validateCoverage(repositoryRoot, incomplete);
  assert.ok(failures.includes('coverage manifest: missing E12'));
});
