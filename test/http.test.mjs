import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createHttpHandler, createOpenApiDocument, httpInvocationPath } from '../dist/http.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import Ajv2020 from 'ajv/dist/2020.js';
import * as z from 'zod';

const identity = { namespace: 'catalog', name: 'album.lookup', majorVersion: 1 };
const inputSchema = fromZod(z.object({ slug: z.string().min(1) }));
const outputSchema = fromZod(
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('found'),
      album: z.object({ slug: z.string(), title: z.string() }),
    }),
    z.object({ kind: z.literal('missing') }),
  ]),
);

function publicRegistry(execute) {
  const definition = defineCapability({
    identity,
    description: 'Look up a public sample album by slug.',
    input: inputSchema,
    output: outputSchema,
    risk: 'read',
    access: { kind: 'public' },
  });
  const binding = bindCapability(definition, {
    id: 'sample-catalog',
    targets: ['server'],
    execute,
  });
  return { definition, registry: createCapabilityRegistry([definition], [binding]) };
}

function options() {
  return {
    resolveExecutionContext: () => ({
      caller: { kind: 'anonymous' },
      authorization: {
        authorize: (request) => request.access.kind === 'public' && request.risk === 'read',
      },
    }),
  };
}

async function withHttpServer(handler, run) {
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request('http://127.0.0.1' + incoming.url, {
      method: incoming.method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function post(body = JSON.stringify({ slug: 'first-light' })) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body };
}

test('HTTP roundtrip invokes shared contract and reports protocol reachability', async () => {
  const { registry } = publicRegistry(async ({ slug }) =>
    slug === 'first-light'
      ? { kind: 'found', album: { slug, title: 'First Light' } }
      : { kind: 'missing' },
  );
  await withHttpServer(createHttpHandler(registry, options()), async (origin) => {
    const health = await fetch(origin + '/agent-native/v1/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      observation: { checkId: 'UAN-003.http-protocol', status: 'passed', evidenceRefs: [] },
    });
    const response = await fetch(origin + httpInvocationPath(identity), post());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      kind: 'found',
      album: { slug: 'first-light', title: 'First Light' },
    });
  });
});

test('malformed JSON, invalid input and oversized bodies fail without calling the handler', async () => {
  let calls = 0;
  const { registry } = publicRegistry(async () => {
    calls += 1;
    return { kind: 'missing' };
  });
  const handler = createHttpHandler(registry, { ...options(), maxRequestBytes: 16 });
  await withHttpServer(handler, async (origin) => {
    assert.equal((await fetch(origin + httpInvocationPath(identity), post('{'))).status, 400);
    assert.equal(
      (await fetch(origin + httpInvocationPath(identity), post(JSON.stringify({ slug: '' }))))
        .status,
      422,
    );
    assert.equal(
      (
        await fetch(
          origin + httpInvocationPath(identity),
          post(JSON.stringify({ slug: 'too-large-body' })),
        )
      ).status,
      413,
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ slug: 'streamed-body-too-large' })),
        );
        controller.close();
      },
    });
    const streamed = await handler(
      new Request('http://localhost' + httpInvocationPath(identity), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        duplex: 'half',
      }),
    );
    assert.equal(streamed.status, 413);
    assert.equal(calls, 0);
  });
});

test('OpenAPI uses contract schemas and hides protected identity and schema metadata', async () => {
  const { registry } = publicRegistry(async () => ({ kind: 'missing' }));
  const hidden = defineCapability({
    identity: { namespace: 'secret', name: 'account.lookup', majorVersion: 1 },
    description: 'SECRET_SCHEMA_SENTINEL',
    input: fromZod(z.object({ privateField: z.string() })),
    output: fromZod(z.object({ privateResult: z.string() })),
    risk: 'read',
    access: { kind: 'protected', scopes: ['account:read'] },
  });
  const hiddenBinding = bindCapability(hidden, {
    id: 'account-service',
    targets: ['server'],
    execute: async () => ({ privateResult: 'never' }),
  });
  const combined = createCapabilityRegistry(
    [...registry.definitions, hidden],
    [...registry.bindings, hiddenBinding],
  );
  const doc = createOpenApiDocument(combined);
  const serialized = JSON.stringify(doc);
  assert.equal(serialized.includes('SECRET_SCHEMA_SENTINEL'), false);
  assert.equal(serialized.includes('account.lookup'), false);
  const operation = doc.paths[httpInvocationPath(identity)].post;
  assert.equal(operation['x-agent-native-capability-id'], 'catalog:album.lookup@1');
  const requestSchema = operation.requestBody.content['application/json'].schema;
  const responseSchema = operation.responses['200'].content['application/json'].schema;
  assert.equal(
    operation.responses['405'].description,
    'Method not allowed for a visible capability path.',
  );
  assert.deepEqual(requestSchema, inputSchema.toJSONSchema());
  assert.deepEqual(responseSchema, outputSchema.toJSONSchema());
  const validator = new Ajv2020().compile(requestSchema);
  assert.equal(validator({ slug: 'first-light' }), true);
  assert.equal(validator({ slug: '' }), false);

  await withHttpServer(createHttpHandler(combined, options()), async (origin) => {
    const unknown = await fetch(
      origin + '/agent-native/v1/capabilities/secret/account.unknown/v1/invoke',
      post(),
    );
    const hiddenResponse = await fetch(origin + httpInvocationPath(hidden.identity), post());
    const malformedHidden = await fetch(origin + httpInvocationPath(hidden.identity), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not-json',
    });
    assert.equal(unknown.status, 404);
    assert.equal(hiddenResponse.status, 404);
    assert.equal(malformedHidden.status, 404);
    const unknownBody = await unknown.json();
    assert.deepEqual(unknownBody, await hiddenResponse.json());
    assert.deepEqual(unknownBody, await malformedHidden.json());
  });
});

test('OpenAPI operation identifiers remain unique for punctuation variants', () => {
  const first = defineCapability({
    identity: { namespace: 'catalog', name: 'album.lookup', majorVersion: 1 },
    description: 'First punctuation variant.',
    input: inputSchema,
    output: outputSchema,
    risk: 'read',
    access: { kind: 'public' },
  });
  const second = defineCapability({
    ...first,
    identity: { namespace: 'catalog', name: 'album-lookup', majorVersion: 1 },
  });
  const document = createOpenApiDocument(createCapabilityRegistry([first, second], []));
  const operations = Object.values(document.paths).map((path) => path.post.operationId);
  assert.equal(new Set(operations).size, 2);
});

test('GET does not invoke and invalid handler output returns a redacted failure', async () => {
  let calls = 0;
  const definition = defineCapability({
    identity,
    description: 'Invalid output fixture.',
    input: inputSchema,
    output: fromZod(z.object({ kind: z.literal('missing') })),
    risk: 'read',
    access: { kind: 'public' },
  });
  const binding = bindCapability(definition, {
    id: 'invalid-output',
    targets: ['server'],
    execute: async () => {
      calls += 1;
      return { kind: 'unexpected', secret: 'OUTPUT_SENTINEL' };
    },
  });
  const handler = createHttpHandler(createCapabilityRegistry([definition], [binding]), options());
  await withHttpServer(handler, async (origin) => {
    const get = await fetch(origin + httpInvocationPath(identity), { method: 'GET' });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.equal(calls, 0);
    const response = await fetch(origin + httpInvocationPath(identity), post());
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.equal(text.includes('OUTPUT_SENTINEL'), false);
    assert.equal(text.includes('invalid-output'), false);
  });
  assert.equal(calls, 1);
});

test('schema-valid non-JSON output returns a redacted 500', async () => {
  const definition = defineCapability({
    identity,
    description: 'Non-JSON output fixture.',
    input: inputSchema,
    output: fromZod(z.any()),
    risk: 'read',
    access: { kind: 'public' },
  });
  const binding = bindCapability(definition, {
    id: 'non-json-output',
    targets: ['server'],
    execute: async () => 1n,
  });
  const handler = createHttpHandler(createCapabilityRegistry([definition], [binding]), options());
  const response = await handler(
    new Request('http://localhost' + httpInvocationPath(identity), post()),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: 'execution_failed', message: 'Capability execution failed.' },
  });
});

test('deadline is signaled to a cooperative binding and returns 504', async () => {
  let observed = false;
  const { registry } = publicRegistry(
    async (_input, context) =>
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          if (context.signal?.aborted) {
            observed = true;
            clearInterval(timer);
            resolve({ kind: 'missing' });
          }
        }, 2);
      }),
  );
  await withHttpServer(
    createHttpHandler(registry, { ...options(), deadlineMs: 20 }),
    async (origin) => {
      const response = await fetch(origin + httpInvocationPath(identity), post());
      assert.equal(response.status, 504);
    },
  );
  assert.equal(observed, true);
});

test('OpenAPI endpoint is reachable and base path rejects traversal', async () => {
  const { registry } = publicRegistry(async () => ({ kind: 'missing' }));
  const handler = createHttpHandler(registry, { ...options(), basePath: '/api/v2' });
  assert.throws(
    () => createHttpHandler(registry, { ...options(), basePath: '/../bad' }),
    /basePath/,
  );
  await withHttpServer(handler, async (origin) => {
    const response = await fetch(origin + '/api/v2/openapi.json');
    assert.equal(response.status, 200);
    const doc = await response.json();
    assert.equal(doc.openapi, '3.1.0');
    assert.ok(doc.paths['/api/v2/capabilities/catalog/album.lookup/v1/invoke']);
  });
});
