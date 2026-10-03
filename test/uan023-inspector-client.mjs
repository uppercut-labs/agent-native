import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const fixtureServerUrl = new URL(
  '../examples/e09-album-explorer/.exported/src/server.mjs',
  import.meta.url,
);
if (!existsSync(fixtureServerUrl)) {
  throw new Error('Run npm run example:e09 first to export the standalone fixture.');
}
const { startE09Server, albumToolName } = await import(fixtureServerUrl.href);

function runInspector(url, method, extra = []) {
  return new Promise((resolve, reject) => {
    const args = [
      '--yes',
      '@modelcontextprotocol/inspector@2.8.0',
      '--cli',
      '--transport',
      'http',
      '--server-url',
      `${url}/mcp`,
      '--method',
      method,
      ...extra,
    ];
    const child = spawn('npx', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 45000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr: stderr.slice(0, 1200) });
    });
  });
}

const server = await startE09Server();
try {
  const list = await runInspector(server.origin, 'tools/list', ['--format', 'json']);
  const appInfo = await runInspector(server.origin, 'tools/call', [
    '--tool-name',
    albumToolName,
    '--app-info',
  ]);
  const found = await runInspector(server.origin, 'tools/call', [
    '--tool-name',
    albumToolName,
    '--tool-args-json',
    '{"slug":"first-light"}',
    '--format',
    'json',
  ]);
  const denied = await runInspector(server.origin, 'tools/call', [
    '--tool-name',
    albumToolName,
    '--tool-args-json',
    '{"slug":"blocked-album"}',
    '--format',
    'json',
  ]);
  const parsed = Object.fromEntries(
    [
      ['list', list],
      ['appInfo', appInfo],
      ['found', found],
      ['denied', denied],
    ].map(([key, value]) => {
      return [
        key,
        {
          code: value.code,
          signal: value.signal,
          json: JSON.parse(value.stdout),
          stderr: value.stderr,
        },
      ];
    }),
  );
  assert.equal(parsed.list.code, 0);
  assert.equal(parsed.list.json?.result?.tools?.length, 1);
  assert.equal(parsed.list.json.result.tools[0].name, albumToolName);
  assert.equal(parsed.appInfo.code, 0);
  assert.equal(parsed.appInfo.json?.hasApp, true);
  assert.equal(parsed.appInfo.json?.resourceMimeType, 'text/html;profile=mcp-app');
  assert.equal(parsed.found.code, 0);
  assert.equal(parsed.found.json?.result?.structuredContent?.result?.kind, 'found');
  assert.equal(parsed.found.json?.result?.structuredContent?.result?.album?.slug, 'first-light');
  assert.equal(parsed.denied.code, 5);
  assert.equal(parsed.denied.json?.result?.isError, true);
  console.log(
    JSON.stringify(
      {
        node: process.version,
        client: '@modelcontextprotocol/inspector@2.8.0',
        toolName: albumToolName,
        results: parsed,
      },
      null,
      2,
    ),
  );
  if (Object.values(parsed).some((value) => value.signal !== null)) process.exitCode = 1;
} finally {
  await server.close();
}
