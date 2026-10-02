import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import {
  bindCapability,
  CapabilityDefinitionError,
  CapabilityRegistryError,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '../dist/index.js';
import { fromZod } from '../dist/adapters/zod.js';
import * as z from 'zod';
import { bindServerOnly } from './fixtures/server-secret-binding.mjs';

const albumInput = fromZod(z.object({ slug: z.string().min(1) }));
const albumOutput = fromZod(
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('found'),
      album: z.object({ slug: z.string(), title: z.string() }),
    }),
    z.object({ kind: z.literal('missing') }),
  ]),
);

function defineAlbum(name = 'album.lookup') {
  return defineCapability({
    identity: { namespace: 'catalog', name, majorVersion: 1 },
    description: 'Find a public album by its slug.',
    input: albumInput,
    output: albumOutput,
    risk: 'read',
    access: { kind: 'public' },
  });
}

function publicReadAuthorization() {
  return {
    authorize(request) {
      return request.risk === 'read' && request.access.kind === 'public';
    },
  };
}

function request(identity, input, authorization = publicReadAuthorization(), runtime = 'local') {
  return { identity, input, runtime, caller: { kind: 'anonymous' }, authorization };
}

test('definitions register without bindings and malformed slugs are rejected', () => {
  const definition = defineAlbum();
  const registry = createCapabilityRegistry([definition], []);

  assert.equal(registry.definitions.length, 1);
  assert.equal(registry.bindings.length, 0);
  assert.throws(() => defineAlbum('Bad Name'), /lowercase capability slugs/);
});

test('missing definition and missing runtime binding are distinct outcomes', async () => {
  const definition = defineAlbum();
  const registry = createCapabilityRegistry([definition], []);
  const missingDefinition = await executeCapability(
    registry,
    request({ namespace: 'catalog', name: 'album.unknown', majorVersion: 1 }, { slug: 'x' }),
  );
  const invalidIdentity = await executeCapability(
    registry,
    request({ namespace: 'bad namespace', name: 'album.lookup', majorVersion: 1 }, { slug: 'x' }),
  );
  const missingBinding = await executeCapability(
    registry,
    request(definition.identity, { slug: 'x' }),
  );

  assert.equal(missingDefinition.kind, 'failure');
  if (missingDefinition.kind === 'failure') {
    assert.equal(missingDefinition.reason, 'capability-missing');
  }
  assert.equal(invalidIdentity.kind, 'failure');
  if (invalidIdentity.kind === 'failure') {
    assert.equal(invalidIdentity.reason, 'invalid-identity');
  }
  assert.equal(missingBinding.kind, 'failure');
  if (missingBinding.kind === 'failure') {
    assert.equal(missingBinding.reason, 'binding-unavailable');
  }
});

test('expected missing album is a validated domain outcome', async () => {
  const definition = defineAlbum();
  const binding = bindCapability(definition, {
    id: 'catalog-memory',
    targets: ['local'],
    execute: async () => ({ kind: 'missing' }),
  });
  assert.equal('invoke' in binding, false);
  const registry = createCapabilityRegistry([definition], [binding]);
  const result = await executeCapability(
    registry,
    request(definition.identity, { slug: 'not-in-catalog' }),
  );

  assert.deepEqual(result, {
    kind: 'success',
    capabilityId: 'catalog:album.lookup@1',
    bindingId: 'catalog-memory',
    value: { kind: 'missing' },
  });
});

test('authorization is rechecked and a denied handler is never called', async () => {
  const definition = defineAlbum();
  let handlerCalls = 0;
  let authorizationCalls = 0;
  const binding = bindCapability(definition, {
    id: 'catalog-memory',
    targets: ['local'],
    execute: async () => {
      handlerCalls += 1;
      return { kind: 'missing' };
    },
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  const authorization = {
    authorize(requestValue) {
      authorizationCalls += 1;
      assert.equal(requestValue.identity.name, 'album.lookup');
      return false;
    },
  };

  for (let invocation = 0; invocation < 2; invocation += 1) {
    const result = await executeCapability(
      registry,
      request(definition.identity, { slug: 'known-to-caller' }, authorization),
    );
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') {
      assert.equal(result.reason, 'unauthorized');
    }
  }

  assert.equal(authorizationCalls, 2);
  assert.equal(handlerCalls, 0);

  const missingAuthorization = await executeCapability(registry, {
    ...request(definition.identity, { slug: 'known-to-caller' }),
    authorization: undefined,
  });
  assert.equal(missingAuthorization.kind, 'failure');
  if (missingAuthorization.kind === 'failure') {
    assert.equal(missingAuthorization.reason, 'authorization-error');
  }
  assert.equal(handlerCalls, 0);
});

test('parses input once before authorization and handler execution', async () => {
  let parseCalls = 0;
  const transformingInput = {
    parse(input) {
      parseCalls += 1;
      return { value: input.value, parsedBy: parseCalls };
    },
    toJSONSchema() {
      return { type: 'object' };
    },
  };
  const output = fromZod(z.object({ value: z.string(), parsedBy: z.number() }));
  const definition = defineCapability({
    identity: { namespace: 'example', name: 'parse.once', majorVersion: 1 },
    description: 'Verify one input parse per execution.',
    input: transformingInput,
    output,
    risk: 'read',
    access: { kind: 'public' },
  });
  const binding = bindCapability(definition, {
    id: 'single-parse',
    targets: ['local'],
    execute: async (input) => input,
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  const result = await executeCapability(
    registry,
    request(definition.identity, { value: 'preserved' }),
  );

  assert.equal(parseCalls, 1);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.deepEqual(result.value, { value: 'preserved', parsedBy: 1 });
  }
});

test('invalid handler output never returns a success result', async () => {
  const definition = defineAlbum();
  const binding = bindCapability(definition, {
    id: 'bad-catalog',
    targets: ['local'],
    execute: async () => ({ kind: 'found', album: { slug: 'x', title: 4 } }),
  });
  const registry = createCapabilityRegistry([definition], [binding]);
  const result = await executeCapability(registry, request(definition.identity, { slug: 'x' }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.reason, 'invalid-output');
    assert.equal(result.observation.checkId, 'UAN-002.invalid-output');
  }
});

test('duplicate identities and ambiguous runtime bindings produce diagnostics', async () => {
  const first = defineAlbum();
  const second = defineAlbum();
  assert.throws(
    () => createCapabilityRegistry([first, second], []),
    (error) =>
      error instanceof CapabilityRegistryError &&
      error.observation.checkId === 'UAN-002.duplicate-definition',
  );

  const bindingA = bindCapability(first, {
    id: 'catalog-a',
    targets: ['local'],
    execute: async () => ({ kind: 'missing' }),
  });
  const bindingB = bindCapability(first, {
    id: 'catalog-b',
    targets: ['local'],
    execute: async () => ({ kind: 'missing' }),
  });
  const registry = createCapabilityRegistry([first], [bindingA, bindingB]);
  const ambiguous = await executeCapability(registry, request(first.identity, { slug: 'x' }));
  const selected = await executeCapability(registry, {
    ...request(first.identity, { slug: 'x' }),
    bindingId: 'catalog-b',
  });

  assert.equal(ambiguous.kind, 'failure');
  if (ambiguous.kind === 'failure') {
    assert.equal(ambiguous.reason, 'binding-ambiguous');
    assert.equal(ambiguous.observation.checkId, 'UAN-002.binding-ambiguous');
  }
  assert.equal(selected.kind, 'success');
  if (selected.kind === 'success') {
    assert.equal(selected.bindingId, 'catalog-b');
  }
});

test('server-only binding is unavailable in browser and its sentinel stays out of package output', async () => {
  const definition = defineAlbum();
  const serverBinding = bindServerOnly(definition);
  const registry = createCapabilityRegistry([definition], [serverBinding]);
  const browserResult = await executeCapability(
    registry,
    request(definition.identity, { slug: 'first-light' }, publicReadAuthorization(), 'browser'),
  );
  const serverResult = await executeCapability(
    registry,
    request(definition.identity, { slug: 'first-light' }, publicReadAuthorization(), 'server'),
  );
  const secretSentinel = 'SERVER_SECRET_SENTINEL_MUST_NEVER_ENTER_BROWSER_BUILD';
  const browserOutputRoot = new URL('../.test-dist/browser/', import.meta.url);
  const packageOutputRoot = new URL('../dist/', import.meta.url);

  async function assertTreeOmitsSentinel(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const entryUrl = new URL(entry.name, `${root.href}${root.href.endsWith('/') ? '' : '/'}`);
      if (entry.isDirectory()) {
        await assertTreeOmitsSentinel(new URL(`${entry.name}/`, `${root.href}`));
      } else {
        const content = await readFile(entryUrl, 'utf8');
        assert.equal(content.includes(secretSentinel), false);
      }
    }
  }

  assert.equal(browserResult.kind, 'failure');
  if (browserResult.kind === 'failure') {
    assert.equal(browserResult.reason, 'binding-unavailable');
  }
  assert.equal(serverResult.kind, 'success');
  await assertTreeOmitsSentinel(browserOutputRoot);
  await assertTreeOmitsSentinel(packageOutputRoot);
});

test('invalid schemas carry a structured diagnostic and omitted access is rejected', () => {
  const invalidSchema = {
    parse() {
      return 'x';
    },
    toJSONSchema() {
      throw new Error('not exportable');
    },
  };
  assert.throws(
    () =>
      defineCapability({
        identity: { namespace: 'catalog', name: 'broken', majorVersion: 1 },
        description: 'Broken schema fixture.',
        input: invalidSchema,
        output: invalidSchema,
        risk: 'read',
        access: { kind: 'public' },
      }),
    (error) =>
      error instanceof CapabilityDefinitionError &&
      error.observation.checkId === 'UAN-002.invalid-schema',
  );

  const missingAccess = {
    identity: { namespace: 'catalog', name: 'no-access', majorVersion: 1 },
    description: 'Missing access is not public.',
    input: albumInput,
    output: albumOutput,
    risk: 'read',
  };
  assert.throws(
    () => createCapabilityRegistry([missingAccess], []),
    (error) =>
      error instanceof CapabilityRegistryError &&
      error.kind === 'invalid-definition' &&
      error.observation.checkId === 'UAN-002.invalid-definition',
  );

  assert.throws(
    () =>
      defineCapability({
        identity: { namespace: 'catalog', name: 'no-access', majorVersion: 1 },
        description: 'Access must be explicit.',
        input: albumInput,
        output: albumOutput,
        risk: 'read',
        access: undefined,
      }),
    /access metadata must be explicit/,
  );
});
