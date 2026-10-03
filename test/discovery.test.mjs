import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { defineCapability, evaluateCapabilityDiscovery } from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';

const input = fromZod(z.object({}));
const output = fromZod(z.object({ ok: z.boolean() }));

function definition(name, risk, access) {
  return defineCapability({
    identity: { namespace: 'policy.test', name, majorVersion: 1 },
    description: 'Policy test.',
    input,
    output,
    risk,
    access,
  });
}

test('shared discovery policy combines authorization and per-surface destructive exposure', async () => {
  const publicRead = definition('public', 'read', { kind: 'public' });
  const protectedWrite = definition('write', 'write', {
    kind: 'protected',
    scopes: ['test:write'],
  });
  const destructive = definition('delete', 'destructive', {
    kind: 'protected',
    scopes: ['test:delete'],
  });

  assert.deepEqual(await evaluateCapabilityDiscovery(publicRead, 'http'), { visible: true });
  assert.deepEqual(await evaluateCapabilityDiscovery(protectedWrite, 'mcp'), {
    visible: false,
    reason: 'authorization-unavailable',
  });
  assert.deepEqual(
    await evaluateCapabilityDiscovery(protectedWrite, 'mcp', undefined, () => true),
    {
      visible: true,
    },
  );
  assert.deepEqual(await evaluateCapabilityDiscovery(destructive, 'mcp', undefined, () => true), {
    visible: false,
    reason: 'surface-not-exposed',
  });
  assert.deepEqual(
    await evaluateCapabilityDiscovery(
      destructive,
      'browser',
      { mcp: { destructive: ['policy.test:delete@1'] } },
      () => true,
    ),
    { visible: false, reason: 'surface-not-exposed' },
  );
  const exposure = { mcp: { destructive: ['policy.test:delete@1'] } };
  assert.deepEqual(await evaluateCapabilityDiscovery(destructive, 'mcp', exposure, () => false), {
    visible: false,
    reason: 'authorization-denied',
  });
  assert.deepEqual(await evaluateCapabilityDiscovery(destructive, 'mcp', exposure, () => true), {
    visible: true,
  });
});
