import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  HarnessError,
  assertHarnessSupport,
  createHarnessEvent,
  type HarnessDescriptor,
  type HarnessEvent,
  type HarnessFailureReason,
  type HarnessSessionRef,
  type OpenHarnessSessionRequest,
  type ProgrammaticHarnessAdapter,
  type ResumeHarnessSessionRequest,
  type RunHarnessTurnRequest,
  type CancelHarnessTurnRequest,
  type CloseHarnessSessionRequest,
} from './harness.js';

export type CodexHarnessOptions = {
  readonly model: string;
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly executable?: string;
  /** Arguments before app-server, for an explicitly selected CLI launcher. */
  readonly executableArgs?: readonly string[];
  readonly sandbox?: 'read-only' | 'workspace-write';
  readonly requestTimeoutMs?: number;
  readonly turnTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
};

export class CodexHarnessError extends HarnessError {
  constructor(reason: HarnessFailureReason) {
    super(reason);
    if (reason === 'provider-unavailable') {
      this.message = 'Codex CLI unavailable. Install Codex or select its executable path.';
    } else if (reason === 'authentication-required') {
      this.message =
        'Run codex login with ChatGPT sign-in, then retry. API-key auth is not supported by this adapter.';
    }
  }
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    /[\p{Cc}]/u.test(value)
  ) {
    throw new CodexHarnessError('provider-failed');
  }
  return value;
}
function bounded(value: number | undefined, fallback: number, maximum: number): number {
  const result: number = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new CodexHarnessError('invalid-request');
  }
  return result;
}

type ApprovalDecision = { decision: string } | { action: string; content: null };

type Pending = {
  resolve(value: JsonObject): void;
  reject(error: CodexHarnessError): void;
  timer: ReturnType<typeof setTimeout>;
};

// Raw protocol values are short-lived and never returned as normalized harness events.
class AppServer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly pending: Map<number, Pending> = new Map<number, Pending>();
  onNotification: ((method: string, params: JsonObject) => void) | undefined;
  onFailure: ((error: CodexHarnessError) => void) | undefined;
  private nextId: number = 0;
  private buffer: string = '';
  private failure: CodexHarnessError | undefined;
  private closing: Promise<void> | undefined;
  private readonly exited: Promise<void>;

  constructor(
    private readonly options: CodexHarnessOptions,
    private readonly timeoutMs: number,
    workspace: string,
  ) {
    this.child = spawn(
      options.executable ?? 'codex',
      [...(options.executableArgs ?? []), 'app-server', '--listen', 'stdio://'],
      { cwd: workspace, stdio: 'pipe', shell: false, windowsHide: true },
    );
    this.exited = new Promise<void>((resolve: () => void): void => {
      this.child.once('close', (): void => {
        this.fail('provider-failed');
        resolve();
      });
    });
    this.child.on('error', (): void => this.fail('provider-unavailable'));
    this.child.stdin.on('error', (): void => this.fail('provider-failed'));
    this.child.stderr.resume();
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string): void => {
      this.buffer += chunk;
      if (this.buffer.length > 2_097_152) {
        this.fail('provider-failed');
        return;
      }
      let newline: number = this.buffer.indexOf('\n');
      while (newline !== -1 && !this.failure) {
        const line: string = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.fail('provider-failed');
        }
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  private send(value: unknown): void {
    if (this.failure) throw this.failure;
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private receive(value: unknown): void {
    if (!object(value)) throw new CodexHarnessError('provider-failed');
    if (typeof value['method'] === 'string') {
      if (value['id'] !== undefined) {
        // This noninteractive adapter never grants server-initiated permissions.
        const method: string = value['method'];
        const result: ApprovalDecision | undefined =
          method === 'item/commandExecution/requestApproval' ||
          method === 'item/fileChange/requestApproval'
            ? { decision: 'decline' }
            : method === 'mcpServer/elicitation/request'
              ? { action: 'decline', content: null }
              : undefined;
        this.send(
          result === undefined
            ? {
                id: value['id'],
                error: { code: -32601, message: 'Interactive request unsupported.' },
              }
            : { id: value['id'], result },
        );
      } else if (object(value['params'])) this.onNotification?.(value['method'], value['params']);
      return;
    }
    if (typeof value['id'] !== 'number') throw new CodexHarnessError('provider-failed');
    const pending: Pending | undefined = this.pending.get(value['id']);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(value['id']);
    if (object(value['error'])) pending.reject(new CodexHarnessError('provider-failed'));
    else if (object(value['result'])) pending.resolve(value['result']);
    else pending.reject(new CodexHarnessError('provider-failed'));
  }

  request(method: string, params: JsonObject): Promise<JsonObject> {
    if (this.failure) return Promise.reject(this.failure);
    const id: number = ++this.nextId;
    return new Promise<JsonObject>(
      (resolve: (value: JsonObject) => void, reject: (error: CodexHarnessError) => void): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => this.fail('timeout'), this.timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        try {
          this.send({ id, method, params });
        } catch {
          this.fail('provider-failed');
        }
      },
    );
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'agent_native_harness', version: '0.1.0' },
    });
    this.send({ method: 'initialized', params: {} });
    const account: JsonObject = await this.request('account/read', { refreshToken: false });
    if (
      account['requiresOpenaiAuth'] !== true ||
      !object(account['account']) ||
      account['account']['type'] !== 'chatgpt'
    ) {
      throw new CodexHarnessError('authentication-required');
    }
  }

  fail(reason: HarnessFailureReason): void {
    if (this.failure) return;
    this.failure = new CodexHarnessError(reason);
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
    this.onFailure?.(this.failure);
    queueMicrotask((): void => {
      void this.close().catch((): void => console.error('Codex app-server cleanup failed.'));
    });
  }

  close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }

  private async stop(): Promise<void> {
    this.fail('session-closed');
    this.child.stdin.end();
    const timeout: number = bounded(this.options.shutdownTimeoutMs, 2000, 10_000);
    const wait: () => Promise<boolean> = async (): Promise<boolean> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const closed: boolean = await Promise.race([
        this.exited.then((): boolean => true),
        new Promise<boolean>((resolve: (value: boolean) => void): void => {
          timer = setTimeout((): void => resolve(false), timeout);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return closed;
    };
    if (await wait()) return;
    this.child.kill('SIGTERM');
    if (await wait()) return;
    this.child.kill('SIGKILL');
    if (!(await wait())) throw new CodexHarnessError('timeout');
  }
}

class EventQueue {
  private readonly events: HarnessEvent[] = [];
  private wake: (() => void) | undefined;
  private error: CodexHarnessError | undefined;
  push(event: HarnessEvent): void {
    if (this.events.length >= 256) {
      this.fail(new CodexHarnessError('provider-failed'));
      return;
    }
    this.events.push(event);
    this.wake?.();
  }
  fail(error: CodexHarnessError): void {
    this.error ??= error;
    this.wake?.();
  }
  async next(): Promise<HarnessEvent> {
    while (this.events.length === 0 && !this.error) {
      await new Promise<void>((resolve: () => void): void => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
    if (this.error) throw this.error;
    const event: HarnessEvent | undefined = this.events.shift();
    if (!event) throw new CodexHarnessError('provider-failed');
    return event;
  }
}

type SessionState = {
  workspace: string;
  server: AppServer;
  closed: boolean;
  active?: { queue: EventQueue; turnId?: string };
};

export function createCodexHarnessAdapter(input: CodexHarnessOptions): ProgrammaticHarnessAdapter {
  const options: Readonly<CodexHarnessOptions> = Object.freeze({
    ...input,
    ...(input.executableArgs === undefined
      ? {}
      : { executableArgs: Object.freeze([...input.executableArgs]) }),
  });
  if (
    typeof options.model !== 'string' ||
    !/^[a-zA-Z0-9._-]{1,128}$/.test(options.model) ||
    (options.effort !== undefined &&
      !['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) ||
    (options.sandbox !== undefined && !['read-only', 'workspace-write'].includes(options.sandbox))
  ) {
    throw new CodexHarnessError('invalid-request');
  }
  const requestTimeout: number = bounded(options.requestTimeoutMs, 30_000, 300_000);
  const turnTimeout: number = bounded(options.turnTimeoutMs, 180_000, 3_600_000);
  bounded(options.shutdownTimeoutMs, 2000, 10_000);
  let sessions: Map<string, SessionState> = new Map();
  const descriptor: HarnessDescriptor = Object.freeze({
    provider: 'codex',
    targets: Object.freeze(['local'] as const),
    features: Object.freeze(['resume', 'cancel', 'usage'] as const),
  });
  async function workspaceFor(path: string): Promise<string> {
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new CodexHarnessError('invalid-request');
    try {
      const canonical: string = await realpath(path);
      if (!(await stat(canonical)).isDirectory()) throw new CodexHarnessError('invalid-request');
      return canonical;
    } catch {
      throw new CodexHarnessError('invalid-request');
    }
  }
  function stateFor(session: HarnessSessionRef, allowClosed: boolean = false): SessionState {
    if (session.provider !== 'codex' || session.target !== 'local')
      throw new CodexHarnessError('session-not-found');
    const state: SessionState | undefined = sessions.get(session.sessionId);
    if (!state) throw new CodexHarnessError('session-not-found');
    if (state.closed && !allowClosed) throw new CodexHarnessError('session-closed');
    return state;
  }
  function threadParams(workspace: string): JsonObject {
    return {
      cwd: workspace,
      model: options.model,
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: options.sandbox ?? 'workspace-write',
    };
  }
  async function startServer(workspace: string): Promise<AppServer> {
    let server: AppServer = new AppServer(options, requestTimeout, workspace);
    try {
      await server.initialize();
      return server;
    } catch (error: unknown) {
      await server.close();
      throw error;
    }
  }
  return {
    async describe(): Promise<HarnessDescriptor> {
      return descriptor;
    },
    async openSession(request: OpenHarnessSessionRequest): Promise<HarnessSessionRef> {
      assertHarnessSupport(descriptor, request.target);
      if (request.target !== 'local') throw new CodexHarnessError('unsupported-target');
      const workspace: string = await workspaceFor(request.workspace);
      let server: AppServer = await startServer(workspace);
      try {
        const result: JsonObject = await server.request('thread/start', threadParams(workspace));
        if (!object(result['thread']) || result['thread']['cwd'] !== workspace)
          throw new CodexHarnessError('provider-failed');
        const session: HarnessSessionRef = createHarnessEvent({
          type: 'session-started',
          session: {
            provider: 'codex',
            target: 'local',
            sessionId: identifier(result['thread']['id']),
          },
        }).session;
        if (sessions.has(session.sessionId)) throw new CodexHarnessError('provider-failed');
        sessions.set(session.sessionId, { workspace, server, closed: false });
        return session;
      } catch (error: unknown) {
        await server.close();
        throw error;
      }
    },
    async resumeSession(request: ResumeHarnessSessionRequest): Promise<HarnessSessionRef> {
      assertHarnessSupport(descriptor, request.target, 'resume');
      if (request.target !== 'local') throw new CodexHarnessError('unsupported-target');
      const workspace: string = await workspaceFor(request.workspace);
      let state: SessionState | undefined = sessions.get(request.session.sessionId);
      if (request.session.provider !== 'codex' || request.session.target !== 'local')
        throw new CodexHarnessError('session-not-found');
      if (state && state.workspace !== workspace) throw new CodexHarnessError('invalid-request');
      if (state?.active) throw new CodexHarnessError('turn-active');
      const newServer: boolean = !state || state.closed;
      let server: AppServer = state && !state.closed ? state.server : await startServer(workspace);
      try {
        const existing: JsonObject = await server.request('thread/read', {
          threadId: request.session.sessionId,
          includeTurns: false,
        });
        if (!object(existing['thread']) || existing['thread']['cwd'] !== workspace)
          throw new CodexHarnessError('invalid-request');
        const result: JsonObject = await server.request('thread/resume', {
          ...threadParams(workspace),
          threadId: request.session.sessionId,
        });
        if (
          !object(result['thread']) ||
          result['thread']['id'] !== request.session.sessionId ||
          result['thread']['cwd'] !== workspace
        ) {
          throw new CodexHarnessError('invalid-request');
        }
        state = { workspace, server, closed: false };
        sessions.set(request.session.sessionId, state);
        return createHarnessEvent({ type: 'session-started', session: request.session }).session;
      } catch (error: unknown) {
        if (newServer) await server.close();
        throw error;
      }
    },
    async *runTurn({
      session,
      prompt,
    }: RunHarnessTurnRequest): AsyncGenerator<HarnessEvent, void, undefined> {
      let state: SessionState = stateFor(session);
      if (state.active) throw new CodexHarnessError('turn-active');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 65_536)
        throw new CodexHarnessError('invalid-request');
      let active: NonNullable<SessionState['active']> = { queue: new EventQueue() };
      state.active = active;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let terminal: boolean = false;
      let providerTerminalId: string | undefined;
      state.server.onFailure = (error: CodexHarnessError): void => active.queue.fail(error);
      state.server.onNotification = (method: string, params: JsonObject): void => {
        if (params['threadId'] !== session.sessionId) return;
        const turn: unknown = params['turn'];
        if (method === 'turn/completed' && object(turn)) {
          const turnId: string = identifier(turn['id']);
          const status: unknown = turn['status'];
          providerTerminalId = turnId;
          if (active.turnId === turnId && timer) clearTimeout(timer);
          active.queue.push(
            createHarnessEvent(
              status === 'completed'
                ? { type: 'completed', session, turnId }
                : status === 'interrupted'
                  ? { type: 'cancelled', session, turnId }
                  : {
                      type: 'failed',
                      session,
                      turnId,
                      reason:
                        object(turn['error']) && turn['error']['codexErrorInfo'] === 'unauthorized'
                          ? 'authentication-required'
                          : 'provider-failed',
                    },
            ),
          );
        } else if (
          method === 'thread/tokenUsage/updated' &&
          object(params['tokenUsage']) &&
          object(params['tokenUsage']['last'])
        ) {
          const quantity: unknown = params['tokenUsage']['last']['totalTokens'];
          if (typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity >= 0) {
            active.queue.push(
              createHarnessEvent({
                type: 'usage',
                session,
                turnId: identifier(params['turnId']),
                unit: 'tokens',
                quantity,
              }),
            );
          }
        } else if (
          method === 'item/started' &&
          object(params['item']) &&
          ['commandExecution', 'fileChange', 'mcpToolCall'].includes(String(params['item']['type']))
        ) {
          active.queue.push(
            createHarnessEvent({
              type: 'tool',
              session,
              turnId: identifier(params['turnId']),
              message: 'Codex is using a tool.',
            }),
          );
        }
      };
      try {
        const result: JsonObject = await state.server.request('turn/start', {
          threadId: session.sessionId,
          input: [{ type: 'text', text: prompt }],
          effort: options.effort ?? 'low',
        });
        if (!object(result['turn'])) throw new CodexHarnessError('provider-failed');
        active.turnId = identifier(result['turn']['id']);
        if (providerTerminalId !== active.turnId)
          timer = setTimeout((): void => state.server.fail('timeout'), turnTimeout);
        yield createHarnessEvent({ type: 'turn-started', session, turnId: active.turnId });
        while (!terminal) {
          const event: HarnessEvent = await active.queue.next();
          if (event.type === 'session-started' || event.turnId !== active.turnId) continue;
          terminal = ['completed', 'failed', 'cancelled'].includes(event.type);
          yield event;
        }
      } catch (error: unknown) {
        if (!active.turnId) throw error;
        terminal = true;
        yield createHarnessEvent({
          type: 'failed',
          session,
          turnId: active.turnId,
          reason: error instanceof HarnessError ? error.reason : 'provider-failed',
        });
        state.closed = true;
        await state.server.close();
      } finally {
        if (timer) clearTimeout(timer);
        state.server.onNotification = undefined;
        state.server.onFailure = undefined;
        delete state.active;
        if (!terminal) {
          state.closed = true;
          await state.server.close();
        }
      }
    },
    async cancelTurn({ session, turnId }: CancelHarnessTurnRequest): Promise<void> {
      const state: SessionState = stateFor(session);
      if (!state.active || state.active.turnId !== turnId)
        throw new CodexHarnessError('turn-not-found');
      await state.server.request('turn/interrupt', { threadId: session.sessionId, turnId });
    },
    async closeSession({ session }: CloseHarnessSessionRequest): Promise<void> {
      let state: SessionState = stateFor(session, true);
      state.closed = true;
      await state.server.close();
    },
  };
}
