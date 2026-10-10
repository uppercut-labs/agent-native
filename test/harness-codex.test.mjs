import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createCodexHarnessAdapter } from '@uppercut-labs/agent-native/harness/codex';

const fixture = fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url));
async function setup(mode = 'normal', overrides = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'codex-fixture-'));
  const adapter = createCodexHarnessAdapter({
    model: 'fixture-model',
    executable: process.execPath,
    executableArgs: [fixture, mode],
    requestTimeoutMs: 2000,
    turnTimeoutMs: 2000,
    shutdownTimeoutMs: 50,
    ...overrides,
  });
  return { workspace, adapter, cleanup: () => rm(workspace, { recursive: true, force: true }) };
}
async function drain(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}
async function requests(workspace) {
  return (await readFile(path.join(workspace, 'fixture-requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
async function assertStopped(workspace) {
  const pid = Number(await readFile(path.join(workspace, 'fixture-pid.txt'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('Codex maps threads, resumes across owned processes and projects safe normalized events', async () => {
  const context = await setup();
  const { adapter, workspace } = context;
  let session;
  try {
    assert.deepEqual(await adapter.describe(), {
      provider: 'codex',
      targets: ['local'],
      features: ['resume', 'cancel', 'usage'],
    });
    session = await adapter.openSession({ target: 'local', workspace });
    const first = await drain(adapter.runTurn({ session, prompt: 'first' }));
    assert.deepEqual(
      first.map((event) => event.type),
      ['turn-started', 'tool', 'usage', 'completed'],
    );
    assert.equal(first.find((event) => event.type === 'usage').quantity, 42);
    assert.doesNotMatch(JSON.stringify(first), /SENTINEL/);
    const resumed = await adapter.resumeSession({ session, target: 'local', workspace });
    assert.deepEqual(resumed, session);
    assert.equal(
      (await drain(adapter.runTurn({ session: resumed, prompt: 'second' }))).at(-1).type,
      'completed',
    );
    await adapter.closeSession({ session });
    await assertStopped(workspace);
    await adapter.closeSession({ session });
    const another = createCodexHarnessAdapter({
      model: 'fixture-model',
      executable: process.execPath,
      executableArgs: [fixture, 'normal'],
      shutdownTimeoutMs: 50,
    });
    try {
      assert.deepEqual(
        await another.resumeSession({ session, target: 'local', workspace }),
        session,
      );
      assert.equal(
        (await drain(another.runTurn({ session, prompt: 'third' }))).at(-1).type,
        'completed',
      );
    } finally {
      await another.closeSession({ session });
    }
    const transcript = await requests(workspace);
    const authReads = transcript.filter((value) => value.method === 'account/read');
    assert(authReads.every((value) => value.params.refreshToken === false));
    assert.equal(transcript.filter((value) => value.method === 'thread/resume').length, 2);
    assert.equal(
      transcript.find((value) => value.method === 'thread/start').params.sandbox,
      'workspace-write',
    );
    assert.equal(transcript.find((value) => value.method === 'turn/start').params.effort, 'low');
  } finally {
    if (session) await adapter.closeSession({ session });
    await context.cleanup();
  }
});

test('Codex rejects alternate auth, missing runtime and malformed or timed-out handshakes', async () => {
  assert.throws(() => createCodexHarnessAdapter({}), { reason: 'invalid-request' });
  for (const [mode, reason] of [
    ['no-auth', 'authentication-required'],
    ['api-key', 'authentication-required'],
    ['malformed', 'provider-failed'],
    ['hang-init', 'timeout'],
  ]) {
    // Only the hanging handshake exercises the request deadline. The other modes answer
    // promptly and keep the default budget so a slow fixture start cannot turn them into timeouts.
    const context = await setup(mode, mode === 'hang-init' ? { requestTimeoutMs: 150 } : {});
    try {
      await assert.rejects(
        context.adapter.openSession({ target: 'local', workspace: context.workspace }),
        { reason },
      );
      await assertStopped(context.workspace);
    } finally {
      await context.cleanup();
    }
  }
  const context = await setup('normal', {
    executable: path.join(tmpdir(), 'absent-codex-executable'),
    executableArgs: [],
  });
  try {
    await assert.rejects(
      context.adapter.openSession({ target: 'local', workspace: context.workspace }),
      (error) => error.reason === 'provider-unavailable' && /Install Codex/.test(error.message),
    );
  } finally {
    await context.cleanup();
  }
});

test('Codex handles concurrency, targeted interrupt, closed sessions and rejected workspace changes', async () => {
  const context = await setup();
  const { adapter, workspace } = context;
  const other = await mkdtemp(path.join(tmpdir(), 'codex-other-'));
  let session;
  try {
    await assert.rejects(adapter.openSession({ target: 'cloud' }), {
      reason: 'unsupported-target',
    });
    await assert.rejects(adapter.openSession({ target: 'local', workspace: 'relative' }), {
      reason: 'invalid-request',
    });
    session = await adapter.openSession({ target: 'local', workspace });
    await assert.rejects(adapter.resumeSession({ session, target: 'local', workspace: other }), {
      reason: 'invalid-request',
    });
    await copyFile(
      path.join(workspace, 'fixture-thread.json'),
      path.join(other, 'fixture-thread.json'),
    );
    const unknown = createCodexHarnessAdapter({
      model: 'fixture-model',
      executable: process.execPath,
      executableArgs: [fixture, 'normal'],
      shutdownTimeoutMs: 50,
    });
    await assert.rejects(unknown.resumeSession({ session, target: 'local', workspace: other }), {
      reason: 'invalid-request',
    });
    await assertStopped(other);
    assert.equal(
      (await requests(other)).some((value) => value.method === 'thread/resume'),
      false,
    );
    const turn = adapter.runTurn({ session, prompt: 'hang' });
    const started = (await turn.next()).value;
    await assert.rejects(drain(adapter.runTurn({ session, prompt: 'overlap' })), {
      reason: 'turn-active',
    });
    await assert.rejects(adapter.resumeSession({ session, target: 'local', workspace }), {
      reason: 'turn-active',
    });
    await assert.rejects(adapter.cancelTurn({ session, turnId: 'wrong' }), {
      reason: 'turn-not-found',
    });
    await adapter.cancelTurn({ session, turnId: started.turnId });
    assert.equal((await drain(turn)).at(-1).type, 'cancelled');
    await adapter.closeSession({ session });
    await assert.rejects(drain(adapter.runTurn({ session, prompt: 'after' })), {
      reason: 'session-closed',
    });
  } finally {
    if (session) await adapter.closeSession({ session });
    await context.cleanup();
    await rm(other, { recursive: true, force: true });
  }
});

test('provider completion stops the deadline while consumers render queued events', async () => {
  const context = await setup('normal', { turnTimeoutMs: 75 });
  let session;
  try {
    session = await context.adapter.openSession({ target: 'local', workspace: context.workspace });
    const stream = context.adapter.runTurn({ session, prompt: 'first' });
    await stream.next();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await drain(stream)).at(-1).type, 'completed');
  } finally {
    if (session) await context.adapter.closeSession({ session });
    await context.cleanup();
  }
});

test('Codex distinguishes failed turns, exit, timeout and abandoned streams while cleaning up', async () => {
  for (const prompt of ['fail', 'crash', 'hang']) {
    const context = await setup('normal', { turnTimeoutMs: 75 });
    let session;
    try {
      session = await context.adapter.openSession({
        target: 'local',
        workspace: context.workspace,
      });
      const events = await drain(context.adapter.runTurn({ session, prompt }));
      assert.equal(events.at(-1).type, 'failed');
      assert.equal(events.at(-1).reason, prompt === 'hang' ? 'timeout' : 'provider-failed');
      assert.doesNotMatch(JSON.stringify(events), /RAW_ERROR_SENTINEL/);
    } finally {
      if (session) await context.adapter.closeSession({ session });
      await assertStopped(context.workspace);
      await context.cleanup();
    }
  }
  const context = await setup('ignore-close');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  let session;
  try {
    session = await context.adapter.openSession({ target: 'local', workspace: context.workspace });
    const stream = context.adapter.runTurn({ session, prompt: 'hang' });
    await stream.next();
    await stream.return();
    await assertStopped(context.workspace);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    unrelated.kill();
    if (session) await context.adapter.closeSession({ session });
    await context.cleanup();
  }
});

test('noninteractive Codex adapter declines server permission requests', async () => {
  const context = await setup();
  let session;
  try {
    session = await context.adapter.openSession({ target: 'local', workspace: context.workspace });
    await drain(context.adapter.runTurn({ session, prompt: 'approval' }));
    await context.adapter.closeSession({ session });
    const reply = (await requests(context.workspace)).find((value) => value.id === 'approval-1');
    assert.deepEqual(reply.result, { decision: 'decline' });
  } finally {
    if (session) await context.adapter.closeSession({ session });
    await context.cleanup();
  }
});
