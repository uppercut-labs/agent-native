import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRecoveryFixture } from './recovery.mjs';

process.env.UAN_E07_TEST_MODE = '1';
const directory = await mkdtemp(path.join(tmpdir(), 'e07-recovery-'));
try {
  const journalPath = path.join(directory, 'operations.json');
  await writeFile(journalPath, '[]', { mode: 0o600 });
  const fixture = createRecoveryFixture(journalPath);
  const write = fixture.call('write', { key: 'operation-1', value: 'sample' });
  await fixture.started.promise;
  const timeout = await write;
  assert.equal(timeout.isError, true);
  assert.match(timeout.content[0].text, /write may have completed/);
  // docs:start reconcile-write
  const pending = await fixture.call('status', { key: 'operation-1' });
  assert.deepEqual(pending.structuredContent.result, { state: 'pending', commits: 0 });
  // The fixture now allows the original operation to finish; do not submit another write.
  fixture.release.resolve();
  await fixture.completed.promise;
  const committed = await fixture.call('status', { key: 'operation-1' });
  assert.deepEqual(committed.structuredContent.result, { state: 'committed', commits: 1 });
  assert.equal(fixture.counts().writes, 1);
  assert.equal(fixture.counts().invocations, 1);
  // docs:end reconcile-write
  console.log(
    JSON.stringify({
      timeout: timeout.content[0].text,
      pending: pending.structuredContent.result,
      committed: committed.structuredContent.result,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
