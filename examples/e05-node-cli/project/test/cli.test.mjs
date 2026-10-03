import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';
import {
  httpHandler,
  createThrowingHttpHandler,
  registry,
  createAuthorization,
} from '../src/catalog.mjs';

const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const identity = 'example.catalog:album.lookup@1';
process.env.E05_TOKEN = 'fixture-secret-token';

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    if (options.stdin === undefined) child.stdin.end();
    else child.stdin.end(options.stdin);
  });
}

async function listen(handler, responseDelay = 0) {
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (value !== undefined) headers.set(name, value);
    }
    if (responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelay));
    }
    if (outgoing.destroyed) return;
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
  return {
    url: 'http://127.0.0.1:' + address.port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function machineResult(run) {
  assert.equal(run.stdout.endsWith('\n'), true);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.schemaVersion, 'uan.cli-result/v1');
  return parsed;
}

test('local and authenticated remote invocation return the same logical result', async () => {
  const local = await runCli(['--mode', 'local', identity, '--slug', 'first-light']);
  const localResult = machineResult(local);
  assert.equal(local.code, 0);
  assert.deepEqual(localResult.result.value, {
    kind: 'found',
    album: { slug: 'first-light', title: 'First Light' },
  });
  assert.match(local.stderr, /target=local/);

  const quotedJson = await runCli([
    '--mode',
    'local',
    identity,
    '--input-json',
    '{"slug": "first-light"}',
  ]);
  assert.equal(quotedJson.code, 0);
  assert.deepEqual(machineResult(quotedJson).result.value, localResult.result.value);

  const server = await listen(httpHandler);
  try {
    const remote = await runCli(
      ['--mode', 'remote', '--profile', 'demo', identity, '--slug', 'first-light'],
      {
        env: {
          ...process.env,
          UAN_PROFILE_DEMO_URL: server.url,
          UAN_PROFILE_DEMO_TOKEN: 'fixture-secret-token',
          E05_TOKEN: 'fixture-secret-token',
        },
      },
    );
    const remoteResult = machineResult(remote);
    assert.equal(remote.code, 0);
    assert.deepEqual(remoteResult.result.value, localResult.result.value);
    assert.match(remote.stderr, /target=remote capability=.* profile=demo/);
    assert.equal(remote.stdout.includes('fixture-secret-token'), false);
    assert.equal(remote.stderr.includes('fixture-secret-token'), false);

    const denied = await runCli(
      ['--mode', 'remote', '--profile', 'demo', identity, '--slug', 'first-light'],
      {
        env: {
          ...process.env,
          UAN_PROFILE_DEMO_URL: server.url,
          UAN_PROFILE_DEMO_TOKEN: 'wrong-fixture-token',
          E05_TOKEN: 'fixture-secret-token',
        },
      },
    );
    assert.equal(denied.code, 1);
    assert.equal(machineResult(denied).result.reason, 'capability-missing');
  } finally {
    await server.close();
  }
});

test('help is generated from identity and schema and describes target/version', async () => {
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /agent-native 0\.0\.0/);
  assert.match(help.stdout, /Local executes .* remote invokes/s);
  assert.match(help.stdout, /example\.catalog:album\.lookup@1/);
  assert.match(help.stdout, /--slug <string>/);
});

test('invalid schema input, malformed stdin, unknown version, and missing profile fail closed', async () => {
  const invalid = await runCli(['--mode', 'local', identity, '--slug', 'not valid']);
  assert.equal(invalid.code, 2);
  assert.equal(machineResult(invalid).result.reason, 'invalid-input');

  const stdin = await runCli(['--mode', 'local', identity, '--input-json', '-'], { stdin: '{bad' });
  assert.equal(stdin.code, 1);
  assert.equal(machineResult(stdin).result.reason, '--input-json must contain valid JSON');

  const missingVersion = await runCli([
    '--mode',
    'local',
    'example.catalog:album.lookup@2',
    '--slug',
    'first-light',
  ]);
  assert.equal(missingVersion.code, 1);
  assert.equal(machineResult(missingVersion).result.reason, 'capability-missing');

  const missingProfile = await runCli(
    ['--mode', 'remote', '--profile', 'demo', identity, '--slug', 'first-light'],
    { env: { ...process.env, UAN_PROFILE_DEMO_URL: undefined, UAN_PROFILE_DEMO_TOKEN: undefined } },
  );
  assert.equal(missingProfile.code, 1);
  assert.equal(machineResult(missingProfile).result.reason, 'credential-profile-unavailable');
});

test('shell metacharacters remain one invalid value and a project path with spaces is usable', async () => {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'uan cli path '));
  const sentinel = path.join(workingDirectory, 'SHOULD_NOT_EXIST');
  try {
    const value = '$(touch ' + sentinel + '); first-light';
    const run = await runCli(['--mode', 'local', identity, '--slug', value], {
      cwd: workingDirectory,
    });
    assert.equal(run.code, 2);
    assert.equal(machineResult(run).result.reason, 'invalid-input');
    const { access } = await import('node:fs/promises');
    await assert.rejects(access(sentinel));
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
});

async function runApi(
  args,
  fetcher,
  credentialProfiles = { demo: { baseUrl: 'https://example.test', token: 'fixture-token' } },
) {
  let stdout = '';
  let stderr = '';
  const code = await runCapabilityCli(
    args,
    {
      registry,
      authorization: createAuthorization(),
      caller: { kind: 'anonymous' },
      credentialProfiles,
      fetcher,
    },
    {
      writeStdout(value) {
        stdout += value;
      },
      writeStderr(value) {
        stderr += value;
      },
    },
  );
  return { code, stdout, stderr };
}

test('remote mode bounds a fetcher that ignores AbortSignal and validates returned output', async () => {
  let sawAbortSignal = false;
  const timed = await runApi(
    [
      '--mode',
      'remote',
      '--profile',
      'demo',
      '--timeout-ms',
      '20',
      identity,
      '--slug',
      'first-light',
    ],
    (_url, init) => {
      sawAbortSignal = init.signal instanceof AbortSignal;
      return new Promise(() => {});
    },
  );
  assert.equal(timed.code, 1);
  assert.equal(machineResult(timed).result.reason, 'deadline-exceeded');
  assert.equal(sawAbortSignal, true);

  const invalidOutput = await runApi(
    ['--mode', 'remote', '--profile', 'demo', identity, '--slug', 'first-light'],
    async () => ({ ok: true, json: async () => ({ kind: 'unexpected' }) }),
  );
  assert.equal(invalidOutput.code, 1);
  assert.equal(machineResult(invalidOutput).result.reason, 'invalid-output');
});

test('remote credentials require an own profile and secure or loopback origin', async () => {
  const inherited = await runApi(
    ['--mode', 'remote', '--profile', 'constructor', identity, '--slug', 'first-light'],
    fetch,
    {},
  );
  assert.equal(inherited.code, 1);
  assert.equal(machineResult(inherited).result.reason, 'credential-profile-unavailable');

  const insecure = await runApi(
    ['--mode', 'remote', '--profile', 'demo', identity, '--slug', 'first-light'],
    fetch,
    { demo: { baseUrl: 'http://example.test', token: 'not-to-leak' } },
  );
  assert.equal(insecure.code, 1);
  assert.equal(machineResult(insecure).result.reason, 'insecure-profile-url');
  assert.equal(insecure.stderr.includes('not-to-leak'), false);

  const ignoredBinding = await runCli([
    '--mode',
    'remote',
    '--profile',
    'demo',
    '--binding-id',
    'server-album-catalog',
    identity,
    '--slug',
    'first-light',
  ]);
  assert.equal(ignoredBinding.code, 1);
  assert.equal(
    machineResult(ignoredBinding).result.reason,
    '--binding-id is only valid with --mode local',
  );
});

test('remote handler failures remain machine-readable and redacted', async () => {
  const server = await listen(createThrowingHttpHandler());
  try {
    const run = await runCli(
      ['--mode', 'remote', '--profile', 'demo', identity, '--slug', 'first-light'],
      {
        env: {
          ...process.env,
          UAN_PROFILE_DEMO_URL: server.url,
          UAN_PROFILE_DEMO_TOKEN: 'fixture-secret-token',
          E05_TOKEN: 'fixture-secret-token',
        },
      },
    );
    assert.equal(run.code, 1);
    assert.equal(machineResult(run).result.reason, 'remote-execution-failed');
    assert.equal(run.stdout.includes('HANDLER_SECRET_SENTINEL'), false);
    assert.equal(run.stderr.includes('HANDLER_SECRET_SENTINEL'), false);
  } finally {
    await server.close();
  }
});

test('remote timeout returns a versioned failure and nonzero exit', async () => {
  const delayed = await listen(httpHandler, 150);
  try {
    const run = await runCli(
      [
        '--mode',
        'remote',
        '--profile',
        'demo',
        '--timeout-ms',
        '25',
        identity,
        '--slug',
        'first-light',
      ],
      {
        env: {
          ...process.env,
          UAN_PROFILE_DEMO_URL: delayed.url,
          UAN_PROFILE_DEMO_TOKEN: 'fixture-secret-token',
          E05_TOKEN: 'fixture-secret-token',
        },
      },
    );
    assert.equal(run.code, 1);
    assert.equal(machineResult(run).result.reason, 'deadline-exceeded');
  } finally {
    await delayed.close();
  }
});
