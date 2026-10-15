import assert from 'node:assert/strict';
import test from 'node:test';
import { runSelectionRecipe, runOperatorRecipe } from '../src/executor-selection.mjs';

test('exact identities and explicit binding selection distinguish failures without running handlers', async () => {
  const result = await runSelectionRecipe();
  assert.equal(result.selected.kind, 'success');
  assert.equal(result.failures.length, 4);
});

test('operator reasons stay private while MCP failures redact inputs, outputs and exceptions', async () => {
  const result = await runOperatorRecipe();
  assert.deepEqual(result.reasons, ['handler-failed', 'invalid-output']);
  assert.equal(result.hidden, 'denied');
});
