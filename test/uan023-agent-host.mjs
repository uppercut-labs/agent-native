import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Opt-in real-host probe: a commercial agent CLI connects to the flagship E04 sidecar over
// Streamable HTTP MCP and calls the shared album tool. It runs model inference on the operator's
// own signed-in CLI, so it is not part of npm run check. Usage:
//   node test/uan023-agent-host.mjs agy      (Antigravity CLI)
//   node test/uan023-agent-host.mjs claude   (Claude Code)
const host = process.argv[2];
if (host !== 'agy' && host !== 'claude') throw new Error('Choose a host: agy or claude.');
const exported = fileURLToPath(
  new URL('../examples/e04-worker-sidecar/.exported/', import.meta.url),
);
if (!existsSync(join(exported, 'node_modules', 'wrangler'))) {
  throw new Error('Run npm run example:e04 first to export and install the sidecar.');
}
const serverName = 'uan-albums-probe';
const lookupPattern = /album[._]lookup/;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function parseLines(stdout) {
  return stdout
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

// Each host adapter returns { version, calls: [{ input, output, isError }], answer }.
function runAgy(prompt, workdir) {
  const result = spawnSync(
    'agy',
    [
      '-p',
      prompt,
      '--model',
      process.env.AGY_MODEL ?? 'gemini-3.8-flash-low',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '--print-timeout',
      '150s',
    ],
    { cwd: workdir, encoding: 'utf8', timeout: 200000 },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-1500)}`);
  const events = parseLines(result.stdout);
  const calls = events
    .filter(
      (event) =>
        event.event === 'step_update' &&
        event.step_update.tool_name === 'call_mcp_tool' &&
        event.step_update.state !== 'ACTIVE',
    )
    .map((event) => event.step_update)
    .filter((step) => lookupPattern.test(step.tool_info.parameters.ToolName))
    .map((step) => ({
      input: step.tool_info.parameters.Arguments,
      output: step.tool_info.output ?? JSON.stringify(step.tool_info.error ?? null),
      isError:
        step.state === 'ERROR' || /"isError":\s*true|error/i.test(step.tool_info.output ?? ''),
    }));
  const final = events.find((event) => event.event === 'result');
  return { calls, answer: final?.result.response ?? '' };
}

function runClaude(prompt, workdir, url) {
  const config = join(workdir, 'mcp.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { [serverName]: { type: 'http', url } } }));
  const result = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--model',
      process.env.CLAUDE_MODEL ?? 'haiku',
      '--mcp-config',
      config,
      '--strict-mcp-config',
      '--allowedTools',
      `mcp__${serverName}`,
      '--output-format',
      'stream-json',
      '--verbose',
    ],
    { cwd: workdir, encoding: 'utf8', timeout: 200000 },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-1500)}`);
  const events = parseLines(result.stdout);
  const uses = events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message.content)
    .filter((block) => block.type === 'tool_use' && lookupPattern.test(block.name));
  const results = events
    .filter((event) => event.type === 'user')
    .flatMap((event) => event.message.content)
    .filter((block) => block.type === 'tool_result');
  const calls = uses.map((use) => {
    const match = results.find((block) => block.tool_use_id === use.id);
    return {
      input: use.input,
      output: JSON.stringify(match?.content ?? null),
      isError: match?.is_error === true,
    };
  });
  const final = events.find((event) => event.type === 'result');
  return { calls, answer: final?.result ?? '' };
}

const port = await freePort();
const url = `http://127.0.0.1:${port}/mcp`;
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
  { cwd: exported, stdio: 'ignore' },
);
const workdir = mkdtempSync(join(tmpdir(), 'uan023-host-'));
let registered = false;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      await delay(250);
    }
  }
  assert.ok(ready, 'Wrangler sidecar did not start');
  if (host === 'agy') {
    const added = spawnSync('agy', ['mcp', 'add', serverName, url], { encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    registered = true;
  }
  const version = spawnSync(host, ['--version'], { encoding: 'utf8' }).stdout.trim();
  const run = (prompt) =>
    host === 'agy' ? runAgy(prompt, workdir) : runClaude(prompt, workdir, url);

  const found = run(
    `Use the album lookup tool from the ${serverName} MCP server to look up the slug "first-light". Reply with only the album title.`,
  );
  assert.ok(found.calls.length >= 1, 'host did not call the album tool');
  assert.deepEqual(found.calls[0].input, { slug: 'first-light' });
  assert.match(found.calls[0].output, /First Light/);
  assert.equal(found.calls[0].isError, false);
  assert.match(found.answer, /First Light/);
  console.log(`${host} ${version}: MCP call {slug:"first-light"} -> ${found.answer.trim()}`);

  const invalid = run(
    `Call the album lookup tool from the ${serverName} MCP server exactly once with the slug "Not A Slug!" (exactly that string, unchanged) and report whether it returned an error. Do not retry or fix the slug.`,
  );
  const invalidCall = invalid.calls.find((call) => call.input.slug === 'Not A Slug!');
  assert.ok(invalidCall !== undefined, 'host did not send the invalid slug');
  assert.equal(invalidCall.isError, true);
  assert.doesNotMatch(invalidCall.output, /First Light|Blue Hour/);
  console.log(`${host}: invalid slug returned a tool error and no album`);
} finally {
  if (registered) spawnSync('agy', ['mcp', 'remove', serverName], { encoding: 'utf8' });
  worker.kill('SIGTERM');
  rmSync(workdir, { recursive: true, force: true });
}
