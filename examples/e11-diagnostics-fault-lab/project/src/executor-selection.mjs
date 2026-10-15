import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { createMcpHandler, mcpToolName } from '@uppercut-labs/agent-native/mcp';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';

const publicRead = {
  authorize: (request) => request.risk === 'read' && request.access.kind === 'public',
};

export async function runSelectionRecipe() {
  let calls = 0;
  const read = defineCapability({
    identity: { namespace: 'example.selection', name: 'binding.read', majorVersion: 1 },
    description: 'Read a sample through an explicitly selected local binding.',
    input: fromZod(z.object({})),
    output: fromZod(z.object({ value: z.string() })),
    risk: 'read',
    access: { kind: 'public' },
  });
  const registry = createCapabilityRegistry(
    [read],
    ['primary', 'secondary'].map((id) =>
      bindCapability(read, {
        id,
        targets: ['local'],
        execute: () => {
          calls++;
          return { value: id };
        },
      }),
    ),
  );
  const request = {
    identity: read.identity,
    runtime: 'local',
    input: {},
    caller: { kind: 'anonymous' },
    authorization: publicRead,
  };
  const failures = [
    [
      { identity: { ...read.identity, name: 'example.selection binding.read' } },
      'invalid-identity',
    ],
    [{ identity: { ...read.identity, name: 'missing' } }, 'capability-missing'],
    [{ runtime: 'browser' }, 'binding-unavailable'],
    [{}, 'binding-ambiguous'],
  ];
  for (const [override, reason] of failures) {
    const result = await executeCapability(registry, { ...request, ...override });
    assert.equal(result.kind, 'failure');
    assert.equal(result.reason, reason);
    assert.equal(calls, 0);
  }
  // docs:start select-binding
  const selected = await executeCapability(registry, {
    identity: { namespace: 'example.selection', name: 'binding.read', majorVersion: 1 },
    runtime: 'local',
    bindingId: 'primary',
    input: {},
    caller: { kind: 'anonymous' },
    authorization: publicRead,
  });
  assert.equal(selected.kind, 'success');
  assert.equal(selected.bindingId, 'primary');
  assert.deepEqual(selected.value, { value: 'primary' });
  // docs:end select-binding
  assert.equal(calls, 1);
  return { failures: failures.map(([, reason]) => reason), selected };
}

export async function runOperatorRecipe() {
  const failures = [];
  let calls = 0;
  const definitions = ['throws', 'bad-output', 'hidden'].map((name) =>
    defineCapability({
      identity: { namespace: 'example.selection', name, majorVersion: 1 },
      description: 'Synthetic operator diagnostics fixture.',
      input: fromZod(z.object({ credential: z.string() })),
      output: fromZod(z.object({ value: z.string() })),
      risk: 'read',
      access:
        name === 'hidden' ? { kind: 'protected', scopes: ['fixture:read'] } : { kind: 'public' },
    }),
  );
  const registry = createCapabilityRegistry(
    definitions,
    definitions.map((definition) =>
      bindCapability(definition, {
        id: definition.identity.name,
        targets: ['server'],
        execute: () => {
          calls++;
          if (definition.identity.name === 'throws') throw new Error('EXCEPTION_SENTINEL');
          return { privateOutput: 'OUTPUT_SENTINEL' };
        },
      }),
    ),
  );
  // docs:start operator-hook
  const handler = createMcpHandler(registry, {
    resolveExecutionContext: () => ({ caller: { kind: 'anonymous' }, authorization: publicRead }),
    onToolFailure: (failure) => {
      // Store only the bounded diagnostic in the application's private operator sink.
      failures.push(failure);
    },
  });
  // docs:end operator-hook
  const client = new Client({ name: 'e11-operator', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        fetch: (url, init) => handler(new Request(url, init)),
      }),
    );
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      definitions
        .slice(0, 2)
        .map((definition) => mcpToolName(definition.identity))
        .sort(),
    );
    for (const definition of definitions.slice(0, 2)) {
      const result = await client.callTool({
        name: mcpToolName(definition.identity),
        arguments: { credential: 'CREDENTIAL_SENTINEL' },
      });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, 'Capability execution is unavailable.');
      assert.doesNotMatch(
        JSON.stringify(result),
        /CREDENTIAL_SENTINEL|OUTPUT_SENTINEL|EXCEPTION_SENTINEL/,
      );
    }
    await assert.rejects(
      client.callTool({
        name: mcpToolName(definitions[2].identity),
        arguments: { credential: 'CREDENTIAL_SENTINEL' },
      }),
    );
    assert.equal(calls, 2);
    assert.deepEqual(
      failures.map((failure) => failure.reason),
      ['handler-failed', 'invalid-output'],
    );
    assert.ok(
      failures.every((failure) => failure.observation.checkId === `UAN-002.${failure.reason}`),
    );
    assert.doesNotMatch(
      JSON.stringify(failures),
      /CREDENTIAL_SENTINEL|OUTPUT_SENTINEL|EXCEPTION_SENTINEL/,
    );
    assert.notEqual(
      mcpToolName({ namespace: 'example.selection', name: 'binding.read', majorVersion: 1 }),
      mcpToolName({ namespace: 'example', name: 'selection.binding.read', majorVersion: 1 }),
    );
    return { reasons: failures.map((failure) => failure.reason), hidden: 'denied', calls };
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(
    JSON.stringify({ selection: await runSelectionRecipe(), operator: await runOperatorRecipe() }),
  );
}
