import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as core from '../dist/index.js';
import {
  HarnessError,
  assertHarnessSupport,
  createHarnessEvent,
} from '@uppercut-labs/agent-native/harness';

function fakeAdapter(features = ['resume', 'cancel', 'usage', 'mcp']) {
  const descriptor = { provider: 'fixture', targets: ['local'], features };
  const sessions = new Map();
  let count = 0;
  function stateFor(session) {
    const state = sessions.get(session.sessionId);
    if (!state || session.provider !== 'fixture' || session.target !== 'local') {
      throw new HarnessError('session-not-found');
    }
    if (state.closed) throw new HarnessError('session-closed');
    return state;
  }
  return {
    async describe() {
      return descriptor;
    },
    async openSession(request) {
      assertHarnessSupport(descriptor, request.target);
      if (!request.workspace) throw new HarnessError('invalid-request');
      const session = { provider: 'fixture', target: 'local', sessionId: `opaque:/?${++count}` };
      sessions.set(session.sessionId, { workspace: request.workspace, turns: 0, closed: false });
      return session;
    },
    async resumeSession(request) {
      assertHarnessSupport(descriptor, request.target, 'resume');
      const state = stateFor(request.session);
      if (request.workspace !== state.workspace) throw new HarnessError('invalid-request');
      return { ...request.session };
    },
    async *runTurn({ session, prompt }) {
      const state = stateFor(session);
      if (state.active) throw new HarnessError('turn-active');
      if (!prompt) throw new HarnessError('invalid-request');
      const turnId = `turn-${++state.turns}`;
      state.active = turnId;
      state.cancelled = false;
      try {
        yield createHarnessEvent({ type: 'turn-started', session, turnId });
        yield createHarnessEvent({ type: 'progress', session, turnId, message: 'Working.' });
        if (state.cancelled || state.closed) {
          yield createHarnessEvent({ type: 'cancelled', session, turnId });
          return;
        }
        if (prompt === 'fail') {
          yield createHarnessEvent({ type: 'failed', session, turnId, reason: 'provider-failed' });
          return;
        }
        yield createHarnessEvent({ type: 'completed', session, turnId });
      } finally {
        state.active = undefined;
      }
    },
    async cancelTurn({ session, turnId }) {
      assertHarnessSupport(descriptor, session.target, 'cancel');
      const state = stateFor(session);
      if (state.active !== turnId) throw new HarnessError('turn-not-found');
      state.cancelled = true;
    },
    async closeSession({ session }) {
      const state = sessions.get(session.sessionId);
      if (!state || session.provider !== 'fixture' || session.target !== 'local') {
        throw new HarnessError('session-not-found');
      }
      state.closed = true;
    },
  };
}

async function drain(events) {
  const collected = [];
  for await (const event of events) collected.push(event);
  return collected;
}

test('neutral lifecycle preserves opaque identity through two turns, cancel and close', async () => {
  const adapter = fakeAdapter();
  assert.deepEqual((await adapter.describe()).features, ['resume', 'cancel', 'usage', 'mcp']);
  const session = await adapter.openSession({ target: 'local', workspace: '/fixture' });
  const first = await drain(adapter.runTurn({ session, prompt: 'first' }));
  assert.deepEqual(
    first.map((event) => event.type),
    ['turn-started', 'progress', 'completed'],
  );
  const resumed = await adapter.resumeSession({ session, target: 'local', workspace: '/fixture' });
  assert.deepEqual(resumed, session);
  const second = await drain(adapter.runTurn({ session: resumed, prompt: 'second' }));
  assert.notEqual(first[0].turnId, second[0].turnId);
  assert.equal(second[0].session.sessionId, 'opaque:/?1');
  const active = adapter.runTurn({ session: resumed, prompt: 'cancel' });
  const started = await active.next();
  await adapter.cancelTurn({ session: resumed, turnId: started.value.turnId });
  assert.deepEqual(
    (await drain(active)).map((event) => event.type),
    ['progress', 'cancelled'],
  );
  await adapter.closeSession({ session: resumed });
  await adapter.closeSession({ session: resumed });
  await assert.rejects(drain(adapter.runTurn({ session, prompt: 'after close' })), {
    reason: 'session-closed',
  });
});

test('unsupported operations and missing sessions use stable typed failures', async () => {
  const adapter = fakeAdapter([]);
  await assert.rejects(adapter.openSession({ target: 'cloud' }), {
    name: 'HarnessError',
    reason: 'unsupported-target',
  });
  await assert.rejects(adapter.openSession({ target: 'local' }), { reason: 'invalid-request' });
  const session = await adapter.openSession({ target: 'local', workspace: '/fixture' });
  await assert.rejects(adapter.resumeSession({ session, target: 'local', workspace: '/fixture' }), {
    reason: 'unsupported-feature',
  });
  await assert.rejects(adapter.cancelTurn({ session, turnId: 'missing' }), {
    reason: 'unsupported-feature',
  });
  await assert.rejects(
    drain(adapter.runTurn({ session: { ...session, sessionId: 'other' }, prompt: 'x' })),
    { reason: 'session-not-found' },
  );
});

test('concurrent turns, wrong workspace and provider failure cannot imply success', async () => {
  const adapter = fakeAdapter();
  const session = await adapter.openSession({ target: 'local', workspace: '/fixture' });
  await assert.rejects(adapter.resumeSession({ session, target: 'local', workspace: '/other' }), {
    reason: 'invalid-request',
  });
  const active = adapter.runTurn({ session, prompt: 'x' });
  await active.next();
  await assert.rejects(drain(adapter.runTurn({ session, prompt: 'overlap' })), {
    reason: 'turn-active',
  });
  await assert.rejects(adapter.cancelTurn({ session, turnId: 'wrong' }), {
    reason: 'turn-not-found',
  });
  await active.return();
  const failed = await drain(adapter.runTurn({ session, prompt: 'fail' }));
  assert.equal(failed.at(-1).type, 'failed');
  assert.equal(failed.at(-1).reason, 'provider-failed');
  assert.equal(
    failed.some((event) => event.type === 'completed'),
    false,
  );
});

const session = { provider: 'fixture', sessionId: 'opaque:/?id', target: 'local' };
const progress = { type: 'progress', session, turnId: 'turn-1', message: 'Working.' };

test('normalized events bound text and usage and project out provider fields', () => {
  const event = createHarnessEvent({
    ...progress,
    raw: { credentials: 'sentinel' },
    cause: 'sentinel',
  });
  assert.deepEqual(event, progress);
  assert(Object.isFrozen(event) && Object.isFrozen(event.session));
  for (const message of ['', 'x'.repeat(241), 'x\ny', 'x\0y']) {
    assert.throws(() => createHarnessEvent({ ...progress, message }), {
      reason: 'invalid-request',
    });
  }
  assert.equal(createHarnessEvent({ ...progress, message: 'x'.repeat(240) }).message.length, 240);
  for (const quantity of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createHarnessEvent({ type: 'usage', session, turnId: 't', unit: 'tokens', quantity }),
      { reason: 'invalid-request' },
    );
  }
  assert.equal(
    createHarnessEvent({ type: 'usage', session, turnId: 't', unit: 'requests', quantity: 0 })
      .quantity,
    0,
  );
  for (const invalid of [
    { ...progress, session: { ...session, sessionId: 'x'.repeat(1025) } },
    { ...progress, turnId: 'x'.repeat(129) },
    { ...progress, type: 'raw-provider-output' },
    { type: 'failed', session, turnId: 't', reason: 'raw provider exception' },
  ])
    assert.throws(() => createHarnessEvent(invalid), { reason: 'invalid-request' });
  assert.deepEqual(createHarnessEvent({ type: 'session-started', session, raw: 'sentinel' }), {
    type: 'session-started',
    session,
  });
});

test('harness is an isolated export without runtime imports', async () => {
  assert.equal('HarnessError' in core, false);
  assert.equal('createHarnessEvent' in core, false);
  const source = await readFile(new URL('../src/harness.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s/m);
});
