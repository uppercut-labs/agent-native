import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const root = process.cwd();
writeFileSync(path.join(root, 'fixture-pid.txt'), String(process.pid));
const history = path.join(root, 'fixture-thread.json');
let turnCount = 0;
let active;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const response = (id, result) => send({ id, result });
const notification = (method, params) => send({ method, params });
if (mode === 'ignore-close') process.on('SIGTERM', () => {});
const input = createInterface({ input: process.stdin });
input.on('close', () => {
  if (mode !== 'ignore-close') process.exit(0);
});
if (mode === 'ignore-close') setInterval(() => {}, 1000);
input.on('line', (line) => {
  const value = JSON.parse(line);
  appendFileSync(path.join(root, 'fixture-requests.jsonl'), line + '\n');
  const { id, method, params } = value;
  if (!method) return;
  if (method === 'initialize') {
    if (mode === 'hang-init') return;
    if (mode === 'malformed') {
      process.stdout.write('invalid JSON\n');
      return;
    }
    response(id, { userAgent: 'synthetic' });
  } else if (method === 'account/read') {
    response(id, {
      requiresOpenaiAuth: true,
      account:
        mode === 'no-auth'
          ? null
          : {
              type: mode === 'api-key' ? 'apiKey' : 'chatgpt',
              email: 'ACCOUNT_SENTINEL',
              planType: 'PLAN_SENTINEL',
            },
    });
  } else if (method === 'thread/start') {
    const thread = { id: `opaque:/?fixture-${process.pid}`, cwd: params.cwd };
    writeFileSync(history, JSON.stringify(thread));
    response(id, { thread });
  } else if (method === 'thread/read' || method === 'thread/resume') {
    response(id, { thread: JSON.parse(readFileSync(history, 'utf8')) });
  } else if (method === 'turn/start') {
    const threadId = params.threadId;
    const turnId = `turn-${++turnCount}`;
    const prompt = params.input[0].text;
    active = { threadId, turnId };
    response(id, { turn: { id: turnId, status: 'inProgress' } });
    if (prompt === 'crash') {
      process.exit(1);
      return;
    }
    if (prompt === 'hang') return;
    notification('item/agentMessage/delta', { threadId, turnId, delta: 'RAW_MODEL_SENTINEL' });
    notification('item/started', {
      threadId,
      turnId,
      item: { type: 'commandExecution', command: 'RAW_COMMAND_SENTINEL' },
    });
    if (prompt === 'approval')
      send({
        id: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        params: { threadId, turnId, command: 'RAW_COMMAND_SENTINEL' },
      });
    notification('thread/tokenUsage/updated', {
      threadId,
      turnId,
      tokenUsage: { last: { totalTokens: 42 } },
    });
    notification('turn/completed', {
      threadId,
      turn: {
        id: turnId,
        status: prompt === 'fail' ? 'failed' : 'completed',
        error: { message: 'RAW_ERROR_SENTINEL' },
      },
    });
  } else if (method === 'turn/interrupt') {
    response(id, {});
    notification('turn/completed', {
      threadId: active.threadId,
      turn: { id: active.turnId, status: 'interrupted' },
    });
  }
});
