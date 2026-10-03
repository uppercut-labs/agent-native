import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const identity = 'example:distance.convert@1';

function run(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (value) => {
      stdout += value;
    });
    child.stderr.setEncoding('utf8').on('data', (value) => {
      stderr += value;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test('installed generated CLI returns a versioned local result and separates diagnostics', async () => {
  const result = await run([
    '--mode',
    'local',
    identity,
    '--value',
    '12',
    '--from',
    'in',
    '--to',
    'cm',
  ]);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 'uan.cli-result/v1',
    target: { mode: 'local', capabilityId: identity },
    result: {
      kind: 'success',
      capabilityId: identity,
      value: { value: 30.48, unit: 'cm' },
    },
  });
  assert.match(result.stderr, /target=local/);
});

test('installed CLI fails before binding execution for invalid typed input', async () => {
  const result = await run([
    '--mode',
    'local',
    identity,
    '--input-json',
    '{"value":2,"from":"mi","to":"cm"}',
  ]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).result.reason, 'invalid-input');
});
