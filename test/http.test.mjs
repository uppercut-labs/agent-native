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

test('OpenAPI and route lookup omit public definitions without one server binding', async () => {
  const { definition, registry } = publicRegistry(async () => ({ kind: 'missing' }));
  const orphan = defineCapability({
    identity: { namespace: 'catalog', name: 'orphan.read', majorVersion: 1 },
    description: 'NO_HTTP_BINDING_SENTINEL',
    input: fromZod(z.object({})),
    output: fromZod(z.object({ ok: z.boolean() })),
    risk: 'read',
    access: { kind: 'public' },
  });
  const combined = createCapabilityRegistry([...registry.definitions, orphan], registry.bindings);
  const doc = createOpenApiDocument(combined);
  assert.ok(doc.paths[httpInvocationPath(definition.identity)]);
  assert.equal(doc.paths[httpInvocationPath(orphan.identity)], undefined);
  assert.equal(JSON.stringify(doc).includes('NO_HTTP_BINDING_SENTINEL'), false);

  const handler = createHttpHandler(combined, options());
  const response = await handler(
    new Request('http://localhost' + httpInvocationPath(orphan.identity), post('{}')),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'not_found', message: 'Capability not found.' },
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
  const firstBinding = bindCapability(first, {
    id: 'first-server',
    targets: ['server'],
    execute: async () => ({ kind: 'missing' }),
  });
  const secondBinding = bindCapability(second, {
    id: 'second-server',
    targets: ['server'],
    execute: async () => ({ kind: 'missing' }),
  });
  const document = createOpenApiDocument(
    createCapabilityRegistry([first, second], [firstBinding, secondBinding]),
  );
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
  for (const value of [1n, Number.POSITIVE_INFINITY]) {
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
      execute: async () => value,
    });
    const handler = createHttpHandler(createCapabilityRegistry([definition], [binding]), options());
    const response = await handler(
      new Request('http://localhost' + httpInvocationPath(identity), post()),
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: 'execution_failed', message: 'Capability execution failed.' },
    });
  }
});

test('deadline is signaled to a cooperative binding and returns 504', async () => {
  let observed = false;
  let resolveObserved = () => {};
  let observer;
  const observedSignal = new Promise((resolve) => {
    resolveObserved = resolve;
  });
  const { registry } = publicRegistry(
    async (_input, context) =>
      await new Promise((resolve) => {
        observer = setInterval(() => {
          if (context.signal?.aborted) {
            observed = true;
            if (observer !== undefined) clearInterval(observer);
            resolveObserved();
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
  let observationTimeout;
  const settled = await Promise.race([
    observedSignal.then(() => true),
    new Promise((resolve) => {
      observationTimeout = setTimeout(() => resolve(false), 250);
    }),
  ]);
  if (observationTimeout !== undefined) clearTimeout(observationTimeout);
  if (!observed && observer !== undefined) clearInterval(observer);
  assert.equal(settled, true);
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

test('GET overrides map typed query input and appear in OpenAPI without a request body', async () => {
  const definition = defineCapability({
    identity: { namespace: 'content', name: 'search', majorVersion: 1 },
    description: 'Search public content.',
    input: fromZod(
      z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(10).optional() }),
    ),
    output: fromZod(z.object({ query: z.string(), slugs: z.array(z.string()) })),
    risk: 'read',
    access: { kind: 'public' },
    surfaces: {
      http: { path: '/api/content/search', method: 'GET', query: { query: 'q' } },
    },
  });
  let calls = 0;
  const binding = bindCapability(definition, {
    id: 'content-search',
    targets: ['server'],
    execute: async ({ query, limit = 5 }) => {
      calls += 1;
      return { query, slugs: ['one', 'two'].slice(0, limit) };
    },
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  const handler = createHttpHandler(registry, options());

  assert.equal(httpInvocationPath(definition), '/api/content/search');
  const document = createOpenApiDocument(registry);
  const operation = document.paths['/api/content/search'].get;
  assert.equal(operation.requestBody, undefined);
  assert.deepEqual(
    operation.parameters.map(({ name, required }) => ({ name, required })),
    [
      { name: 'q', required: true },
      { name: 'limit', required: false },
    ],
  );

  const response = await handler(
    new Request('http://localhost/api/content/search?q=night&limit=1'),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { query: 'night', slugs: ['one'] });
  assert.equal(calls, 1);

  for (const url of [
    'http://localhost/api/content/search',
    'http://localhost/api/content/search?q=night&limit=1.5',
    'http://localhost/api/content/search?q=night&limit=',
    'http://localhost/api/content/search?q=night&unknown=true',
  ]) {
    const invalid = await handler(new Request(url));
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, 'invalid_input');
  }
  assert.equal(calls, 1);
  const bounded = createHttpHandler(registry, { ...options(), maxRequestBytes: 16 });
  const oversized = await bounded(
    new Request('http://localhost/api/content/search?q=' + 'n'.repeat(32)),
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'request_too_large');
  assert.equal(calls, 1);
  const mutation = await handler(
    new Request('http://localhost/api/content/search?q=night', { method: 'POST' }),
  );
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get('allow'), 'GET');
});

test('HTTP overrides reject GET mutations, unsupported query conversions and duplicate paths', () => {
  assert.throws(
    () =>
      defineCapability({
        identity: { namespace: 'content', name: 'write', majorVersion: 1 },
        description: 'Unsafe GET mutation.',
        input: fromZod(z.object({ value: z.string() })),
        output: fromZod(z.object({ ok: z.boolean() })),
        risk: 'write',
        access: { kind: 'protected', scopes: ['content:write'] },
        surfaces: { http: { path: '/api/content/write', method: 'GET' } },
      }),
    /GET HTTP surfaces/,
  );

  const definitions = ['first', 'second'].map((name) =>
    defineCapability({
      identity: { namespace: 'content', name, majorVersion: 1 },
      description: `${name} duplicate fixture.`,
      input: fromZod(z.object({ filter: z.object({ tag: z.string() }) })),
      output: fromZod(z.object({ ok: z.boolean() })),
      risk: 'read',
      access: { kind: 'public' },
      surfaces: { http: { path: '/api/duplicate', method: 'GET' } },
    }),
  );
  const bindings = definitions.map((definition, index) =>
    bindCapability(definition, {
      id: `duplicate-${index}`,
      targets: ['server'],
      execute: async () => ({ ok: true }),
    }),
  );
  const registry = createCapabilityRegistry(definitions, bindings);
  assert.throws(() => createHttpHandler(registry), /duplicate HTTP path|unsupported query/);

  const unsupported = createCapabilityRegistry([definitions[0]], [bindings[0]]);
  assert.throws(() => createOpenApiDocument(unsupported), /unsupported query conversion/);
});

test('GET query decoding preserves own reserved property names', async () => {
  const input = {
    parse(value) {
      if (typeof value !== 'object' || value === null || !Object.hasOwn(value, '__proto__')) {
        throw new TypeError('missing own query field');
      }
      return value;
    },
    toJSONSchema() {
      return JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}',
      );
    },
  };
  const definition = defineCapability({
    identity: { namespace: 'safe', name: 'query', majorVersion: 1 },
    description: 'Read an own query field.',
    input,
    output: fromZod(z.object({ ok: z.boolean() })),
    risk: 'read',
    access: { kind: 'public' },
    surfaces: { http: { path: '/api/safe/query', method: 'GET' } },
  });
  const binding = bindCapability(definition, {
    id: 'safe-query',
    targets: ['server'],
    execute: async (value) => ({ ok: Object.hasOwn(value, '__proto__') }),
  });
  const handler = createHttpHandler(createCapabilityRegistry([definition], [binding]), options());
  const response = await handler(new Request('http://localhost/api/safe/query?__proto__=value'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal({}.polluted, undefined);
});
