import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createThemePage } from '../src/theme.mjs';

class SimulatedModelContext {
  tools = new Map();
  async registerTool(tool, { signal } = {}) {
    if (signal?.aborted) throw signal.reason;
    this.tools.set(tool.name, tool);
    signal?.addEventListener('abort', () => this.tools.delete(tool.name), { once: true });
  }
}
function testDocument() {
  return {
    defaultView: new EventTarget(),
    documentElement: { dataset: { theme: 'light' } },
    modelContext: new SimulatedModelContext(),
    addEventListener() {},
    removeEventListener() {},
  };
}

test('SIMULATED WebMCP API and human control share the page-local theme binding', async () => {
  const document = testDocument();
  const page = createThemePage(document);
  const { createBrowserCapabilityAdapter } = await import('@uppercut-labs/agent-native/browser');
  const adapter = createBrowserCapabilityAdapter(document);
  const report = await adapter.sync(page.registry, {
    canExpose: page.canExpose,
    resolveExecutionContext: () => ({
      caller: { kind: 'anonymous' },
      authorization: page.authorization,
    }),
  });
  assert.equal(report.registered.length, 1);
  const tool = document.modelContext.tools.get(report.registered[0]);
  const toolResult = await tool.execute(
    { theme: 'dark' },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(toolResult, {
    ok: true,
    capabilityId: 'example.browser:theme.set@1',
    value: { theme: 'dark' },
  });
  assert.equal(document.documentElement.dataset.theme, 'dark');
  const humanResult = await page.setTheme('light');
  assert.equal(humanResult.kind, 'success');
  assert.equal(document.documentElement.dataset.theme, 'light');

  const { executeCapability } = await import('@uppercut-labs/agent-native');
  const serverResult = await executeCapability(page.registry, {
    identity: { namespace: 'example.browser', name: 'theme.set', majorVersion: 1 },
    runtime: 'server',
    input: { theme: 'dark' },
    caller: { kind: 'anonymous' },
    authorization: page.authorization,
  });
  assert.equal(serverResult.kind, 'failure');
  if (serverResult.kind === 'failure') assert.equal(serverResult.reason, 'binding-unavailable');
  adapter.dispose();
});
