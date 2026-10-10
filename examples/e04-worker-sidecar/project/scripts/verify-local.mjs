import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function javascriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, new URL('./', directory));
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function importsNodeBuiltin(source) {
  const builtinNames = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
  const nodeSpecifier = /['"]node:([^'"]+)['"]/g;
  for (const match of source.matchAll(nodeSpecifier)) {
    if (builtinNames.has(match[1])) return true;
  }
  const bareSpecifier = /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(bareSpecifier)) {
    if (!match[1].startsWith('node:') && builtinNames.has(match[1])) return true;
  }
  return false;
}

function getWithHost(port, host) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        headers: { host },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.once('error', reject);
    request.end();
  });
}

const bundleBuild = spawnSync(
  process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', '.worker-bundle'],
  { encoding: 'utf8' },
);
assert.equal(bundleBuild.status, 0, bundleBuild.stderr || bundleBuild.stdout);
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
assert.equal((config.compatibility_flags ?? []).includes('nodejs_compat'), false);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
for (const sample of [
  "import 'node:http';",
  'require("node:crypto")',
  'import "http";',
  'import{a}from"node:crypto"',
  'import("node:fs")',
  'const value=require("http")',
]) {
  assert.equal(importsNodeBuiltin(sample), true, 'Node builtin scanner must catch ' + sample);
}
assert.equal(importsNodeBuiltin('import "node:not-a-builtin";'), false);
const emittedJavaScript = await javascriptFiles(new URL('../.worker-bundle/', import.meta.url));
assert.ok(emittedJavaScript.length > 0, 'Wrangler dry-run emitted no JavaScript to inspect');
for (const file of emittedJavaScript) {
  const source = await readFile(file, 'utf8');
  assert.equal(
    importsNodeBuiltin(source),
    false,
    'Worker bundle imports a Node builtin: ' + file.pathname,
  );
}
assert.ok(builtins.has('http'));

const port = await reservePort();
const origin = 'http://127.0.0.1:' + port;
const worker = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let logs = '';
worker.stdout.on('data', (part) => {
  logs += part;
});
worker.stderr.on('data', (part) => {
  logs += part;
});
const client = new Client({ name: 'e04-fixture', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(origin + '/mcp'));
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      ready = (await fetch(origin + '/health')).ok;
      if (ready) break;
    } catch {}
    if (worker.exitCode !== null) throw new Error('Wrangler exited: ' + logs);
    await delay(250);
  }
  assert.ok(ready, 'Wrangler did not start: ' + logs);

  const allowedOrigin = config.vars.ALLOWED_ORIGIN;
  const health = await fetch(origin + '/health', { headers: { origin: allowedOrigin } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal((await health.json()).catalogRevision, config.vars.CATALOG_REVISION);

  const preflight = await fetch(origin + '/mcp', {
    method: 'OPTIONS',
    headers: { origin: allowedOrigin, 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);

  const deniedOrigin = await fetch(origin + '/health', {
    headers: { origin: 'https://blocked.example' },
  });
  assert.equal(deniedOrigin.status, 403);
  assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);
  assert.equal(await getWithHost(port, 'attacker.example'), 421);

  const schemaResponse = await fetch(origin + '/agent-native/v1/openapi.json');
  assert.equal(schemaResponse.status, 200);
  const schema = await schemaResponse.json();
  assert.ok(schema.paths['/agent-native/v1/capabilities/example.catalog/album.lookup/v1/invoke']);
  const http = await fetch(
    origin + '/agent-native/v1/capabilities/example.catalog/album.lookup/v1/invoke',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'first-light' }),
    },
  );
  assert.deepEqual(await http.json(), {
    kind: 'found',
    album: { slug: 'first-light', title: 'First Light' },
  });

  await client.connect(transport);
  assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 1);
  const result = await client.callTool({
    name: tools.tools[0].name,
    arguments: { slug: 'blue-hour' },
  });
  assert.deepEqual(result.structuredContent, {
    result: { kind: 'found', album: { slug: 'blue-hour', title: 'Blue Hour' } },
  });
  assert.equal(result.isError, undefined);

  const capabilityId = 'example.catalog:album.lookup@1';
  const runCli = (args, env = {}) =>
    spawnSync(process.execPath, ['src/cli.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  const sidecarProfile = {
    UAN_PROFILE_SIDECAR_URL: origin,
    UAN_PROFILE_SIDECAR_TOKEN: 'unused-for-public-read',
  };
  const cliFound = runCli(
    ['--mode', 'remote', '--profile', 'sidecar', capabilityId, '--slug', 'first-light'],
    sidecarProfile,
  );
  assert.equal(cliFound.status, 0, cliFound.stderr);
  const cliEnvelope = JSON.parse(cliFound.stdout);
  assert.equal(cliEnvelope.schemaVersion, 'uan.cli-result/v1');
  assert.deepEqual(cliEnvelope.result.value, {
    kind: 'found',
    album: { slug: 'first-light', title: 'First Light' },
  });
  assert.equal(cliFound.stdout.includes('unused-for-public-read'), false);
  assert.equal(cliFound.stderr.includes('unused-for-public-read'), false);
  const cliNoProfile = runCli([
    '--mode',
    'remote',
    '--profile',
    'sidecar',
    capabilityId,
    '--slug',
    'first-light',
  ]);
  assert.notEqual(cliNoProfile.status, 0);
  assert.equal(JSON.parse(cliNoProfile.stdout).result.reason, 'credential-profile-unavailable');
  const cliInvalid = runCli(
    ['--mode', 'remote', '--profile', 'sidecar', capabilityId, '--slug', ''],
    sidecarProfile,
  );
  assert.notEqual(cliInvalid.status, 0);
  assert.equal(JSON.parse(cliInvalid.stdout).result.reason, 'invalid-input');

  process.stdout.write(
    'PASS local workerd bundle scan, Host/Origin/CORS negatives, HTTP/OpenAPI, official MCP 2025-11-25 client roundtrip, and shared-contract remote CLI.\n',
  );
} finally {
  await client.close().catch(() => {});
  worker.kill('SIGTERM');
}
