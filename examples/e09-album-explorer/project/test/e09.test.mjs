import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createAlbumExplorerController } from '../src/view-controller.mjs';
import { albumOutput } from '../src/output-schema.mjs';
import {
  albumResourceUri,
  albumToolName,
  getHandlerCalls,
  startE09Server,
  registry,
} from '../src/server.mjs';
import { validateMcpAppResources } from '@uppercut-labs/agent-native/mcp-apps';
import { createDiagnosticObservation } from '@uppercut-labs/agent-native/diagnostics';

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

test('official Apps view receives an MCP tool result and makes a host-mediated follow-up call', async () => {
  const server = await startE09Server();
  const client = new Client({ name: 'e09-host-conformance', version: '1.0.0' });
  const view = new App({ name: 'E09 fixture view', version: '1.0.0' }, {}, { autoResize: false });
  const host = new AppBridge(
    client,
    { name: 'E09 conformance host', version: '1.0.0' },
    { serverTools: {} },
  );
  const [viewTransport, hostTransport] = transportPair();
  const states = [];
  const explorer = createAlbumExplorerController({
    app: view,
    toolName: albumToolName,
    outputSchema: albumOutput,
    render: (state) => states.push(state),
  });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`)));
    await withTimeout(
      Promise.all([view.connect(viewTransport), host.connect(hostTransport)]),
      3000,
      'Official Apps view and bridge handshake timed out.',
    );
    const initial = await client.callTool({
      name: albumToolName,
      arguments: { slug: 'first-light' },
    });
    host.sendToolInput({ arguments: { slug: 'first-light' } });
    host.sendToolResult(initial);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(states.at(-1).kind, 'found');
    assert.equal(states.at(-1).album.title, 'First Light');

    const followUp = await explorer.lookup('blue-hour');
    assert.deepEqual(followUp, { kind: 'found', album: { slug: 'blue-hour', title: 'Blue Hour' } });
    assert.ok(states.some((state) => state.kind === 'loading' && state.slug === 'blue-hour'));
    assert.deepEqual(states.at(-1), followUp);
    assert.equal(getHandlerCalls(), 2);
    assert.deepEqual(
      createDiagnosticObservation({
        checkId: 'UAN-012.apps-conformance',
        status: 'passed',
        evidenceRefs: ['E-UAN-012-01'],
      }),
      {
        checkId: 'UAN-012.apps-conformance',
        status: 'passed',
        evidenceRefs: ['E-UAN-012-01'],
      },
    );

    const denied = await explorer.lookup('blocked-album');
    assert.equal(denied.kind, 'denied');
    assert.equal(getHandlerCalls(), 2);
    host.sendToolInput({ arguments: { slug: 7 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(states.at(-1).kind, 'unavailable');
  } finally {
    explorer.dispose();
    await view.close();
    await host.close();
    await client.close();
    await server.close();
  }
});

test('E09 missing, denied, malformed UI data and text-only fallbacks have explicit states', async () => {
  const app = {
    callServerTool: async ({ arguments: args }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            result:
              args.slug === 'absent'
                ? { kind: 'missing' }
                : { kind: 'found', album: { slug: args.slug, title: 'Fallback title' } },
          }),
        },
      ],
    }),
  };
  const states = [];
  const controller = createAlbumExplorerController({
    app,
    toolName: albumToolName,
    outputSchema: albumOutput,
    render: (state) => states.push(state),
  });
  assert.deepEqual(await controller.lookup('absent'), { kind: 'missing' });
  assert.deepEqual(await controller.lookup('first-light'), {
    kind: 'found',
    album: { slug: 'first-light', title: 'Fallback title' },
  });
  controller.receiveResult({
    isError: true,
    content: [{ type: 'text', text: 'Capability not found.' }],
  });
  assert.equal(states.at(-1).kind, 'denied');
  controller.receiveResult({
    structuredContent: { result: { kind: 'unexpected', album: { slug: 'bad-slug', title: 'x' } } },
  });
  assert.equal(states.at(-1).kind, 'unavailable');
  controller.dispose();
});

test('resource registration is allowlisted, origin-closed, and has no external origins or secrets', async () => {
  const badResources = [
    {
      capabilityId: 'example.catalog:album.lookup@1',
      uri: 'https://evil.example/ui',
      name: 'bad',
      html: '<h1>x</h1>',
    },
    {
      capabilityId: 'example.catalog:missing@1',
      uri: 'ui://uppercut/nope.html',
      name: 'bad',
      html: '<h1>x</h1>',
    },
    {
      capabilityId: 'example.catalog:album.lookup@1',
      uri: 'ui://uppercut/external.html',
      name: 'bad',
      html: '<script src="https://evil.example/x.js"></script>',
    },
    {
      capabilityId: 'example.catalog:album.lookup@1',
      uri: 'ui://uppercut/protocol-relative.html',
      name: 'bad',
      html: '<img src="//evil.example/album.jpg">',
    },
    {
      capabilityId: 'example.catalog:album.lookup@1',
      uri: 'ui://uppercut/protocol-relative-css.html',
      name: 'bad',
      html: '<style>body{background:url(//evil.example/a.png)}</style>',
    },
  ];
  assert.throws(() => validateMcpAppResources(registry, [badResources[0]]), /bounded ui:\/\//);
  assert.throws(
    () => validateMcpAppResources(registry, [badResources[1]]),
    /undeclared capability/,
  );
  for (const resource of badResources.slice(2)) {
    assert.throws(
      () => validateMcpAppResources(registry, [resource]),
      /external origins/,
      resource.uri,
    );
  }

  const server = await startE09Server();
  const client = new Client({ name: 'e09-resource-allowlist', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`)));
    const listing = await client.listResources();
    const listedResource = listing.resources.find(
      (candidate) => candidate.uri === albumResourceUri,
    );
    assert.ok(listedResource);
    assert.deepEqual(listedResource._meta?.ui?.csp, {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    });

    const resource = await client.readResource({ uri: albumResourceUri });
    const content = resource.contents[0];
    assert.ok(content && 'text' in content);
    assert.equal(content.mimeType, 'text/html;profile=mcp-app');
    assert.equal(
      /<(?:script|iframe|link|img|source|video|audio)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(
        content.text,
      ),
      false,
    );
    assert.equal(content.text.includes('Authorization:'), false);
    await assert.rejects(client.readResource({ uri: 'ui://uppercut/undeclared.html' }));
  } finally {
    await client.close();
    await server.close();
  }
});
