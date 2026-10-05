import assert from 'node:assert/strict';
import path from 'node:path';
import { createCodexHarnessAdapter } from '@uppercut-labs/agent-native/harness/codex';

const adapter = createCodexHarnessAdapter({
  model: 'fixture-model',
  executable: path.join(process.cwd(), 'intentionally-absent-codex-runtime'),
});
assert.deepEqual((await adapter.describe()).targets, ['local']);
await assert.rejects(
  adapter.openSession({ target: 'local', workspace: process.cwd() }),
  (error) => error.reason === 'provider-unavailable' && /Install Codex/.test(error.message),
);
console.log('Packed Codex export and missing-runtime guidance passed; no inference requested.');
