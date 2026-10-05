import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodexHarnessAdapter } from '@uppercut-labs/agent-native/harness/codex';
import { HarnessError } from '@uppercut-labs/agent-native/harness';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--model' || !/^[A-Za-z0-9._-]{1,128}$/.test(args[1])) {
  console.error('Explicit inference opt-in required: npm run proof:codex -- --model MODEL');
  process.exitCode = 2;
} else {
  const model = args[1];
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-native-codex-proof-'));
  let adapter = createCodexHarnessAdapter({ model, effort: 'low' });
  let session;
  let attached = false;
  const usage = [];
  async function run(prompt) {
    let terminal;
    for await (const event of adapter.runTurn({ session, prompt })) {
      if (event.type === 'usage') usage.push(event.quantity);
      if (['completed', 'failed', 'cancelled'].includes(event.type)) terminal = event;
    }
    if (terminal?.type !== 'completed')
      throw new HarnessError(terminal?.reason ?? 'provider-failed');
  }
  async function verify(expected) {
    const file = path.join(workspace, 'proof.txt');
    const metadata = await lstat(file);
    assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 128);
    const content = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n').replace(/\n$/, '');
    assert.equal(content, expected);
  }
  try {
    session = await adapter.openSession({ target: 'local', workspace });
    attached = true;
    await run('Create proof.txt containing exactly: hello world');
    await verify('hello world');
    await adapter.closeSession({ session });
    attached = false;
    adapter = createCodexHarnessAdapter({ model, effort: 'low' });
    const resumed = await adapter.resumeSession({ session, target: 'local', workspace });
    attached = true;
    assert.deepEqual(resumed, session);
    session = resumed;
    await run('Replace world with Codex.');
    await verify('hello Codex');
    await adapter.closeSession({ session });
    attached = false;
    console.log(
      JSON.stringify({
        provider: 'codex',
        model,
        target: 'local',
        auth_mode: 'managed_chatgpt',
        first_file_verified: true,
        second_file_verified: true,
        same_session_resumed: true,
        resumed_in_new_process: true,
        cleanup_passed: true,
        usage_token_snapshots: usage,
        verified_at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        provider: 'codex',
        outcome: 'failed',
        reason: error instanceof HarnessError ? error.reason : 'proof-verification-failed',
      }),
    );
    process.exitCode = 1;
  } finally {
    try {
      if (session && attached) await adapter.closeSession({ session });
    } catch {
      console.error(JSON.stringify({ provider: 'codex', outcome: 'cleanup_failed' }));
      process.exitCode = 1;
    } finally {
      try {
        await rm(workspace, { recursive: true, force: true });
      } catch {
        console.error(JSON.stringify({ provider: 'codex', outcome: 'workspace_cleanup_failed' }));
        process.exitCode = 1;
      }
    }
  }
}
