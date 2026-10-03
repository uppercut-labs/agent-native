import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mcpToolName } from '@uppercut-labs/agent-native/mcp';
import { JsonFileGrantStore } from '../src/grant-store.mjs';
import { createTestVerifier } from '../src/test-auth.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const editIdentity = { namespace: 'e07.playlists', name: 'edit', majorVersion: 1 };
const deleteIdentity = { namespace: 'e07.playlists', name: 'delete', majorVersion: 1 };
const listIdentity = { namespace: 'e07.playlists', name: 'list-public', majorVersion: 1 };
const issuer = 'https://e07.test-issuer.invalid';
const audience = 'https://e07.test-resource.invalid/mcp';
const app = 'e07-playlist-permissions';

async function startFixture(grantPath, playlistPath, { exposeDelete = false } = {}) {
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      UAN_E07_TEST_MODE: '1',
      E07_EXPOSE_DELETE: exposeDelete ? '1' : '0',
      E07_GRANTS_PATH: grantPath,
      E07_PLAYLISTS_PATH: playlistPath,
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const ready = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error('E07 server readiness timed out: ' + stderr)),
      5000,
    );
    child.once('error', reject);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/READY (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('E07 server exited before readiness (' + code + '): ' + stderr));
    });
  });
  return {
    origin: ready,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([
        exited,
        delay(5000).then(() => {
          throw new Error('E07 server did not stop');
        }),
      ]);
    },
  };
}

async function connect(origin, token) {
  const client = new Client({ name: 'uan-e07-fixture-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
    requestInit: token === undefined ? {} : { headers: { authorization: 'Bearer ' + token } },
  });
  await client.connect(transport);
  return client;
}

function grant(subject, tenantId, scope, grantId) {
  const now = Math.floor(Date.now() / 1000);
  return {
    issuer,
    subject,
    clientId: 'e07-playlist-client',
    tenantId,
    applicationId: app,
    audience,
    policyRevision: 'playlist-policy-v1',
    grantId,
    scopes: [scope],
    issuedAt: now,
    expiresAt: now + 3600,
    revokedAt: null,
  };
}

test('E07 JSON grant store serializes concurrent in-process read-modify-write operations', async () => {
  process.env.UAN_E07_TEST_MODE = '1';
  const parent = await mkdtemp(path.join(os.tmpdir(), 'uan-e07-grant-race-'));
  try {
    const grantPath = path.join(parent, 'grants.json');
    const firstStore = new JsonFileGrantStore(grantPath);
    const secondStore = new JsonFileGrantStore(grantPath);
    await Promise.all([
      firstStore.save(grant('alice', 'tenant-a', 'playlist:edit', 'alice-edit-race')),
      secondStore.save(grant('bob', 'tenant-b', 'playlist:edit', 'bob-edit-race')),
    ]);
    const aliceRows = await firstStore.find({
      issuer,
      subject: 'alice',
      clientId: 'e07-playlist-client',
      tenantId: 'tenant-a',
      applicationId: app,
      audience,
      policyRevision: 'playlist-policy-v1',
    });
    const bobRows = await secondStore.find({
      issuer,
      subject: 'bob',
      clientId: 'e07-playlist-client',
      tenantId: 'tenant-b',
      applicationId: app,
      audience,
      policyRevision: 'playlist-policy-v1',
    });
    assert.deepEqual(
      aliceRows.map((row) => row.grantId),
      ['alice-edit-race'],
    );
    assert.deepEqual(
      bobRows.map((row) => row.grantId),
      ['bob-edit-race'],
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('E07 grant IDs cannot be reused to resurrect a revoked grant', async () => {
  process.env.UAN_E07_TEST_MODE = '1';
  const parent = await mkdtemp(path.join(os.tmpdir(), 'uan-e07-grant-immutable-'));
  try {
    const store = new JsonFileGrantStore(path.join(parent, 'grants.json'));
    const original = grant('alice', 'tenant-a', 'playlist:edit', 'immutable-grant');
    await store.save(original);
    assert.equal(await store.revoke(original.grantId, original.issuedAt + 1), true);
    await assert.rejects(store.save(original), /grant IDs are immutable/i);

    const persisted = await store.find({
      issuer,
      subject: 'alice',
      clientId: 'e07-playlist-client',
      tenantId: 'tenant-a',
      applicationId: app,
      audience,
      policyRevision: 'playlist-policy-v1',
    });
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].revokedAt, original.issuedAt + 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('E07 uses scoped durable grants, official bearer auth, distinct tenants and checked revocation', async () => {
  process.env.UAN_E07_TEST_MODE = '1';
  if (process.env.NODE_ENV === 'production')
    throw new Error('E07 must not run in production mode.');
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.throws(() => createTestVerifier(), /only in explicit local test mode/i);
  assert.throws(
    () => new JsonFileGrantStore(path.join(os.tmpdir(), 'uan-e07-production-guard.json')),
    /not a production store/i,
  );
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;

  const parent = await mkdtemp(path.join(os.tmpdir(), 'uan-e07-playlist-'));
  const grantPath = path.join(parent, 'grants.json');
  const playlistPath = path.join(parent, 'playlists.json');
  const grantStore = new JsonFileGrantStore(grantPath);
  let server;
  const clients = [];
  try {
    server = await startFixture(grantPath, playlistPath);
    const publicClient = await connect(server.origin);
    clients.push(publicClient);
    const publicTools = (await publicClient.listTools()).tools;
    assert.deepEqual(
      publicTools.map((tool) => tool.name),
      [mcpToolName(listIdentity)],
    );
    const publicResult = await publicClient.callTool({
      name: mcpToolName(listIdentity),
      arguments: {},
    });
    assert.equal(publicResult.isError, undefined);
    assert.equal(publicResult.structuredContent.result.playlists[0].id, 'playlist-public');

    const aliceBeforeGrant = await connect(server.origin, 'alice-token');
    clients.push(aliceBeforeGrant);
    assert.deepEqual(
      (await aliceBeforeGrant.listTools()).tools.map((tool) => tool.name),
      [mcpToolName(listIdentity)],
    );
    await assert.rejects(
      aliceBeforeGrant.callTool({
        name: mcpToolName(editIdentity),
        arguments: { playlistId: 'playlist-a', title: 'No grant' },
      }),
    );

    await grantStore.save(grant('alice', 'tenant-a', 'playlist:edit', 'alice-edit'));
    await grantStore.save(grant('bob', 'tenant-b', 'playlist:edit', 'bob-edit'));
    const alice = await connect(server.origin, 'alice-token');
    const bob = await connect(server.origin, 'bob-token');
    clients.push(alice, bob);
    assert.deepEqual(
      (await alice.listTools()).tools.map((tool) => tool.name).sort(),
      [mcpToolName(editIdentity), mcpToolName(listIdentity)].sort(),
    );
    const bobTools = (await bob.listTools()).tools.map((tool) => tool.name);
    assert.equal(bobTools.includes(mcpToolName(deleteIdentity)), false);
    assert.equal(
      (await alice.listTools()).tools.some((tool) => tool.name === mcpToolName(deleteIdentity)),
      false,
    );

    const editOnce = await alice.callTool({
      name: mcpToolName(editIdentity),
      arguments: { playlistId: 'playlist-a', title: 'First title' },
    });
    const editAgain = await alice.callTool({
      name: mcpToolName(editIdentity),
      arguments: { playlistId: 'playlist-a', title: 'Second title' },
    });
    assert.equal(editOnce.isError, undefined);
    assert.equal(editAgain.isError, undefined);
    assert.equal(editAgain.structuredContent.result.title, 'Second title');
    assert.deepEqual(
      (
        await bob.callTool({
          name: mcpToolName(editIdentity),
          arguments: { playlistId: 'playlist-b', title: 'Bob title' },
        })
      ).structuredContent.result,
      { updated: true, title: 'Bob title' },
    );

    const crossTenant = await alice.callTool({
      name: mcpToolName(editIdentity),
      arguments: { playlistId: 'playlist-b', title: 'Cross-tenant write' },
    });
    assert.equal(crossTenant.isError, true);
    const currentPlaylists = JSON.parse(await readFile(playlistPath, 'utf8'));
    assert.equal(currentPlaylists.find((item) => item.id === 'playlist-b').title, 'Bob title');

    const downgraded = await connect(server.origin, 'alice-low-scope-token');
    clients.push(downgraded);
    assert.deepEqual(
      (await downgraded.listTools()).tools.map((tool) => tool.name),
      [mcpToolName(listIdentity)],
    );
    await assert.rejects(
      downgraded.callTool({
        name: mcpToolName(editIdentity),
        arguments: { playlistId: 'playlist-a', title: 'Scope downgrade' },
      }),
    );

    const wrongIssuer = await connect(server.origin, 'wrong-issuer-token');
    clients.push(wrongIssuer);
    assert.deepEqual(
      (await wrongIssuer.listTools()).tools.map((tool) => tool.name),
      [mcpToolName(listIdentity)],
    );
    await assert.rejects(
      wrongIssuer.callTool({
        name: mcpToolName(editIdentity),
        arguments: { playlistId: 'playlist-a', title: 'Wrong issuer' },
      }),
    );
    for (const token of ['wrong-audience-token', 'expired-token']) {
      const rejected = new Client({ name: 'uan-e07-invalid-auth-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(server.origin + '/mcp'), {
        requestInit: { headers: { authorization: 'Bearer ' + token } },
      });
      await assert.rejects(rejected.connect(transport));
      await rejected.close().catch(() => {});
    }

    await server.stop();
    server = await startFixture(grantPath, playlistPath);
    const afterRestart = await connect(server.origin, 'alice-token');
    clients.push(afterRestart);
    const resumed = await afterRestart.callTool({
      name: mcpToolName(editIdentity),
      arguments: { playlistId: 'playlist-a', title: 'After restart' },
    });
    assert.equal(resumed.isError, undefined);
    assert.equal(resumed.structuredContent.result.title, 'After restart');

    await grantStore.save(grant('alice', 'tenant-a', 'playlist:delete', 'alice-delete'));
    const unexposedDeleteClient = await connect(server.origin, 'alice-token');
    clients.push(unexposedDeleteClient);
    assert.equal(
      (await unexposedDeleteClient.listTools()).tools.some(
        (tool) => tool.name === mcpToolName(deleteIdentity),
      ),
      false,
    );
    await assert.rejects(
      unexposedDeleteClient.callTool({
        name: mcpToolName(deleteIdentity),
        arguments: { playlistId: 'playlist-a-delete' },
      }),
    );

    await server.stop();
    server = await startFixture(grantPath, playlistPath, { exposeDelete: true });
    const deleteClient = await connect(server.origin, 'alice-token');
    clients.push(deleteClient);
    assert.ok(
      (await deleteClient.listTools()).tools.some(
        (tool) => tool.name === mcpToolName(deleteIdentity),
      ),
    );
    const bobAfterExposure = await connect(server.origin, 'bob-token');
    clients.push(bobAfterExposure);
    assert.equal(
      (await bobAfterExposure.listTools()).tools.some(
        (tool) => tool.name === mcpToolName(deleteIdentity),
      ),
      false,
    );
    const deleted = await deleteClient.callTool({
      name: mcpToolName(deleteIdentity),
      arguments: { playlistId: 'playlist-a-delete' },
    });
    assert.equal(deleted.isError, undefined);
    assert.equal(deleted.structuredContent.result.deleted, true);
    assert.equal(await grantStore.revoke('alice-delete', Math.floor(Date.now() / 1000)), true);
    assert.equal(
      (await deleteClient.listTools()).tools.some(
        (tool) => tool.name === mcpToolName(deleteIdentity),
      ),
      false,
    );

    await assert.rejects(
      deleteClient.callTool({
        name: mcpToolName(deleteIdentity),
        arguments: { playlistId: 'playlist-a-revoked' },
      }),
      /not found/i,
    );
    assert.ok(
      JSON.parse(await readFile(playlistPath, 'utf8')).some(
        (item) => item.id === 'playlist-a-revoked',
      ),
    );
    assert.deepEqual(
      JSON.parse(await readFile(grantPath, 'utf8'))
        .map((row) => row.grantId)
        .sort(),
      ['alice-delete', 'alice-edit', 'bob-edit'],
    );
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (server) await server.stop();
    await rm(parent, { recursive: true, force: true });
  }
});
