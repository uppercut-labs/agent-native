import { readFile, writeFile, rename } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, mcpToolName } from '@uppercut-labs/agent-native/mcp';
import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
} from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';
import { createTestVerifier, E07_RESOURCE, resolveTestPrincipal } from './test-auth.mjs';

const operation = z.object({
  key: z.string(),
  value: z.string(),
  subject: z.string(),
  tenantId: z.string(),
  state: z.enum(['pending', 'committed']),
  commits: z.number().int().min(0).max(1),
});

// Single-process fixture journal. A real application needs transactional reservation,
// mutation and outcome persistence, plus crash recovery for abandoned pending records.
export class OperationJournal {
  #queue = Promise.resolve();
  constructor(filePath) {
    this.filePath = filePath;
  }
  async records() {
    return z.array(operation).parse(JSON.parse(await readFile(this.filePath, 'utf8')));
  }
  async update(change) {
    const work = this.#queue.then(async () => {
      const records = await this.records();
      const result = change(records);
      await writeFile(`${this.filePath}.tmp`, JSON.stringify(records), { mode: 0o600 });
      await rename(`${this.filePath}.tmp`, this.filePath);
      return result;
    });
    this.#queue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
  async reserve(input, owner) {
    return this.update((records) => {
      const prior = records.find(
        (record) =>
          record.key === input.key &&
          record.subject === owner.subject &&
          record.tenantId === owner.tenantId,
      );
      if (prior) {
        if (prior.value !== input.value) return { kind: 'conflict' };
        return { kind: 'existing', state: prior.state };
      }
      records.push({
        ...input,
        subject: owner.subject,
        tenantId: owner.tenantId,
        state: 'pending',
        commits: 0,
      });
      return { kind: 'reserved' };
    });
  }
  async commit(key, owner) {
    return this.update((records) => {
      const record = records.find(
        (record) =>
          record.key === key &&
          record.subject === owner.subject &&
          record.tenantId === owner.tenantId,
      );
      if (!record || record.state !== 'pending') throw new Error('No pending operation to commit.');
      record.state = 'committed';
      record.commits = 1;
    });
  }
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function createRecoveryFixture(filePath) {
  const journal = new OperationJournal(filePath);
  const started = deferred(),
    release = deferred(),
    completed = deferred();
  let invocations = 0,
    writes = 0,
    aborted = false;
  const write = defineCapability({
    identity: { namespace: 'e07.operations', name: 'write', majorVersion: 1 },
    description:
      'Reserve a caller-owned idempotency key and write a value. After a timeout, check status with the same key before considering resubmission. A different value for that key conflicts.',
    input: fromZod(z.object({ key: z.string().min(1), value: z.string().min(1) })),
    output: fromZod(z.object({ kind: z.enum(['committed', 'pending', 'conflict']) })),
    risk: 'write',
    access: { kind: 'protected', scopes: ['playlist:edit'] },
  });
  const status = defineCapability({
    identity: { namespace: 'e07.operations', name: 'status', majorVersion: 1 },
    description:
      'Read this caller-owned operation by its idempotency key. Pending means do not resubmit; missing is not proof that a remote write never happened.',
    input: fromZod(z.object({ key: z.string().min(1) })),
    output: fromZod(
      z.object({ state: z.enum(['missing', 'pending', 'committed']), commits: z.number().int() }),
    ),
    risk: 'read',
    access: { kind: 'protected', scopes: ['playlist:edit'] },
  });
  const registry = createCapabilityRegistry(
    [write, status],
    [
      bindCapability(write, {
        id: 'journal-write',
        targets: ['server'],
        execute: async (input, context) => {
          invocations++;
          const owner = context.caller.identity;
          const reservation = await journal.reserve(input, owner);
          if (reservation.kind === 'conflict') return { kind: 'conflict' };
          if (reservation.kind === 'existing') return { kind: reservation.state };
          writes++;
          context.signal.addEventListener('abort', () => {
            aborted = true;
          });
          started.resolve();
          // Deliberately ignore cancellation: a remote write can outlive the MCP deadline.
          await release.promise;
          await journal.commit(input.key, owner);
          completed.resolve();
          return { kind: 'committed' };
        },
      }),
      bindCapability(status, {
        id: 'journal-status',
        targets: ['server'],
        execute: async ({ key }, context) => {
          const owner = context.caller.identity;
          const record = (await journal.records()).find(
            (record) =>
              record.key === key &&
              record.subject === owner.subject &&
              record.tenantId === owner.tenantId,
          );
          return record
            ? { state: record.state, commits: record.commits }
            : { state: 'missing', commits: 0 };
        },
      }),
    ],
  );
  const handler = createMcpHandler(registry, {
    deadlineMs: 1000,
    bearerAuth: { verifier: createTestVerifier(), expectedResource: new URL(E07_RESOURCE) },
    resolveTrustedPrincipal: resolveTestPrincipal,
    grantAuthorization: {
      applicationId: 'e07-recovery',
      audience: E07_RESOURCE,
      policyRevision: 'v1',
      store: {
        find: async (query) =>
          query.subject === 'alice' && query.tenantId === 'tenant-a'
            ? [
                {
                  ...query,
                  grantId: 'fixture-grant',
                  scopes: ['playlist:edit'],
                  issuedAt: 1,
                  expiresAt: Math.floor(Date.now() / 1000) + 3600,
                  revokedAt: null,
                },
              ]
            : [],
        save: async () => {
          throw new Error('Fixture grants are fixed.');
        },
        revoke: async () => false,
      },
      authorizeResource: (_request, principal) =>
        principal.subject === 'alice' && principal.tenantId === 'tenant-a',
    },
    discoverProtected: () => true,
  });
  async function call(name, input, token = 'alice-token') {
    if (name !== 'write' && name !== 'status') throw new TypeError('Unknown recovery capability.');
    const client = new Client({ name: 'e07-recovery', version: '1.0.0' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
          fetch: (url, init) => handler(new Request(url, init)),
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      return await client.callTool({
        name: mcpToolName((name === 'write' ? write : status).identity),
        arguments: input,
      });
    } finally {
      await client.close();
    }
  }
  return {
    call,
    journal,
    started,
    release,
    completed,
    counts: () => ({ invocations, writes, aborted }),
  };
}
