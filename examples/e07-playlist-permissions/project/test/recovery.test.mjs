import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRecoveryFixture, OperationJournal } from '../src/recovery.mjs';

test('a timed-out protected write reconciles pending and persisted committed status without retry', async (t) => {
  process.env.UAN_E07_TEST_MODE = '1';
  const directory = await mkdtemp(path.join(tmpdir(), 'e07-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'operations.json');
  await writeFile(filePath, '[]', { mode: 0o600 });
  const fixture = createRecoveryFixture(filePath);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const write = fixture.call('write', { key: 'one', value: 'VALUE_SENTINEL' });
  await fixture.started.promise;
  t.mock.timers.tick(1000);
  const timeout = await write;
  assert.equal(timeout.isError, true);
  assert.match(timeout.content[0].text, /write may have completed.*Do not retry/);
  assert.equal(JSON.stringify(timeout).includes('VALUE_SENTINEL'), false);
  assert.deepEqual(fixture.counts(), { invocations: 1, writes: 1, aborted: true });
  assert.deepEqual((await fixture.call('status', { key: 'one' })).structuredContent.result, {
    state: 'pending',
    commits: 0,
  });
  assert.deepEqual((await fixture.call('status', { key: 'absent' })).structuredContent.result, {
    state: 'missing',
    commits: 0,
  });
  await assert.rejects(fixture.call('status', { key: 'one' }, 'bob-token'), (error) => {
    assert.doesNotMatch(error.message, /VALUE_SENTINEL|commits|pending/);
    return true;
  });
  const duplicate = await fixture.call('write', { key: 'one', value: 'VALUE_SENTINEL' });
  assert.deepEqual(duplicate.structuredContent.result, { kind: 'pending' });
  const conflict = await fixture.call('write', { key: 'one', value: 'different' });
  assert.deepEqual(conflict.structuredContent.result, { kind: 'conflict' });
  fixture.release.resolve();
  await fixture.completed.promise;
  assert.deepEqual((await fixture.call('status', { key: 'one' })).structuredContent.result, {
    state: 'committed',
    commits: 1,
  });
  assert.deepEqual(
    (await fixture.call('write', { key: 'one', value: 'VALUE_SENTINEL' })).structuredContent.result,
    { kind: 'committed' },
  );
  const reopened = new OperationJournal(filePath);
  assert.equal((await reopened.records())[0].commits, 1);
  assert.equal(fixture.counts().writes, 1);
  assert.equal(fixture.counts().invocations, 4);
});
