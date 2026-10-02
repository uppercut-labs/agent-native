import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { parseSdkSchemaDefault } from '../.test-dist/sdk-any-boundary.js';

test('normalizes the MCP SDK default value to unknown before validation', () => {
  assert.equal(parseSdkSchemaDefault({ type: 'string', default: 'safe-value' }), 'safe-value');
  assert.throws(() => parseSdkSchemaDefault({ type: 'string', default: 42 }), z.ZodError);
});
