// SDK-level conformance: the official MCP client calls tools over a loopback HTTP socket, and the
// official ext-apps App and AppBridge carry results into the UI controller. Not a commercial host.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createReactRenderer } from '@uppercut-labs/agent-native/ui/react';
import { createUiAppController } from '../src/app-controller.mjs';
import {
  E13_APPLICATION,
  E13_POLICY,
  E13_RESOURCE,
  MemoryGrantStore,
  createTestVerifier,
  resolveTestPrincipal,
} from '../src/fixture-auth.mjs';
import { createE13Handler, listen, readViews, toolNames, viewUris } from '../src/server.mjs';

process.env.UAN_E13_TEST_MODE = '1';
const views = await readViews();
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function transportPair() {
  let left;
  let right;
  const create = (peer) => ({
    onmessage: undefined,
    onclose: undefined,
    start: async () => {},
    send: async (message) => queueMicrotask(() => peer.onmessage?.(message)),
    close: async () => {},
    setProtocolVersion: () => {},
  });
  left = create({
    get onmessage() {
      return right.onmessage;
    },
  });
  right = create({
    get onmessage() {
      return left.onmessage;
    },
  });
  return [left, right];
}

async function startServer() {
  const handler = createE13Handler({
    views,
    testAuth: {
      verifier: createTestVerifier(),
      resolvePrincipal: resolveTestPrincipal,
      grants: new MemoryGrantStore(),
      application: E13_APPLICATION,
      audience: E13_RESOURCE,
      policy: E13_POLICY,
    },
  });
  return await listen(handler);
}

/** One host session: MCP client (optionally with a bearer token) plus a paired App and AppBridge. */
async function session(origin, pattern, token) {
  const client = new Client({ name: 'e13-host-conformance', version: '1.0.0' });
  const headers = token === undefined ? {} : { authorization: `Bearer ${token}` };
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers } }),
  );
  const view = new App({ name: 'E13 view', version: '1.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(client, { name: 'E13 host', version: '1.0.0' }, { serverTools: {} });
  const [viewTransport, hostTransport] = transportPair();
  let changes = 0;
  let requests = 0;
  const controller = createUiAppController({
    app: view,
    pattern,
    requestId: () => {
      requests += 1;
      return `request_${pattern}_${requests}`;
    },
    onChange: () => {
      changes += 1;
    },
  });
  await Promise.all([view.connect(viewTransport), bridge.connect(hostTransport)]);
  return {
    client,
    bridge,
    controller,
    changes: () => changes,
    async open(args = {}) {
      const result = await client.callTool({ name: toolNames[`${pattern}.open`], arguments: args });
      bridge.sendToolInput({ arguments: args });
      bridge.sendToolResult(result);
      await tick();
      return result;
    },
    async close() {
      await view.close();
      await bridge.close();
      await client.close();
    },
  };
}

const html = (controller) =>
  renderToString(createReactRenderer(createElement).render(controller.store, controller.surfaceId));

test('anonymous hosts see the three views and no save tools', async () => {
  const server = await startServer();
  const client = new Client({ name: 'e13-anonymous', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`)));
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(
      names,
      [toolNames['explore.open'], toolNames['media.open'], toolNames['review.open']].sort(),
    );
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.ok(Object.values(viewUris).includes(tool._meta.ui.resourceUri));
    }
    for (const uri of Object.values(viewUris)) {
      const { contents } = await client.readResource({ uri });
      assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
      assert.ok(contents[0].text.length < 1024 * 1024);
      assert.doesNotMatch(contents[0].text, /<script[^>]+src=/i);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('the review view renders from the host result, keeps local edits on refresh, and disables save when anonymous', async () => {
  const server = await startServer();
  const host = await session(server.origin, 'review');
  try {
    const result = await host.open();
    assert.match(result.content[0].text, /Landing page review/, 'text fallback carries the result');
    const { controller } = host;
    assert.equal(controller.status.kind, 'ready');
    assert.equal(controller.canSave, false);
    assert.match(html(controller), /Landing page review/);
    assert.match(html(controller), /<button[^>]*disabled=""[^>]*>Save selected/);
    controller.store.edit('review', '/records/landing/draft', 'Local wording kept.');
    const errors = await controller.refresh();
    assert.deepEqual(errors, []);
    assert.equal(controller.store.read('review', '/records/landing/draft'), 'Local wording kept.');
  } finally {
    await host.close();
    await server.close();
  }
});

test('a signed-in editor saves through the host bridge; replays are idempotent', async () => {
  const server = await startServer();
  const host = await session(server.origin, 'review', 'editor-token');
  try {
    await host.open();
    const { controller } = host;
    const { store } = controller;
    assert.equal(controller.canSave, true);
    store.edit('review', '/records/landing/draft', 'Saved through the bridge.');
    store.edit('review', '/selected', ['landing']);
    const outcome = await store.dispatch('review', 'save');
    assert.equal(outcome.kind, 'success', JSON.stringify(outcome));
    assert.equal(store.read('review', '/records/landing/before'), 'Saved through the bridge.');

    const args = { requestId: 'replay_request_1', drafts: [{ id: 'setup', draft: 'Once.' }] };
    const first = await host.client.callTool({ name: toolNames['review.save'], arguments: args });
    const again = await host.client.callTool({ name: toolNames['review.save'], arguments: args });
    assert.equal(first.structuredContent.result.replayed, false);
    assert.equal(again.structuredContent.result.replayed, true);
    assert.equal(again.structuredContent.result.revision, first.structuredContent.result.revision);
    const changed = await host.client.callTool({
      name: toolNames['review.save'],
      arguments: { ...args, drafts: [{ id: 'setup', draft: 'Different.' }] },
    });
    assert.equal(changed.isError, true, 'a reused requestId with new input is refused');
  } finally {
    await host.close();
    await server.close();
  }
});

test('a signed-in viewer without the write grant is denied and keeps the edit', async () => {
  const server = await startServer();
  const host = await session(server.origin, 'media', 'viewer-token');
  try {
    await host.open();
    const { controller } = host;
    assert.equal(controller.canSave, false);
    const { tools } = await host.client.listTools();
    assert.ok(!tools.some((tool) => tool.name === toolNames['annotations.save']));
    // The save tool is hidden from this caller, so the server refuses it as unknown.
    await assert.rejects(
      host.client.callTool({
        name: toolNames['annotations.save'],
        arguments: { requestId: 'viewer_attempt_1', annotations: [] },
      }),
      /not found/,
    );
    controller.store.edit('media', '/annotations', [{ id: 'n1', time: 1, text: 'Kept.' }]);
    assert.equal(controller.store.read('media', '/annotations')[0].text, 'Kept.');
  } finally {
    await host.close();
    await server.close();
  }
});

test('the explorer and media views render, and a malformed host result fails safely', async () => {
  const server = await startServer();
  const explore = await session(server.origin, 'explore');
  const media = await session(server.origin, 'media', 'editor-token');
  try {
    await explore.open({ attempts: 4, rate: 0.07 });
    assert.equal(explore.controller.store.read('explore', '/attempts'), 4);
    assert.match(html(explore.controller), /25\.19/);
    await media.open();
    assert.match(html(media.controller), /Opening tone/);
    media.controller.store.edit('media', '/annotations', [{ id: 'n1', time: 2, text: 'Tone' }]);
    const saved = await media.controller.store.dispatch('media', 'save');
    assert.equal(saved.kind, 'success', JSON.stringify(saved));

    explore.bridge.sendToolResult({ content: [{ type: 'text', text: 'not json' }] });
    await tick();
    assert.equal(explore.controller.status.kind, 'error');
    assert.equal(explore.controller.store.read('explore', '/attempts'), 4, 'last valid state kept');
  } finally {
    await explore.close();
    await media.close();
    await server.close();
  }
});
