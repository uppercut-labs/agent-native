import { assertNever } from './core/assert-never.js';
import { canonicalCapabilityId, type CapabilityDefinition } from './core/contracts.js';
import {
  executeCapability,
  type AuthorizationPort,
  type AuthorizationRequest,
  type ExecutionCaller,
  type ExecutionFailureKind,
  type ExecutionResult,
} from './core/executor.js';
import type { CapabilityBinding, CapabilityRegistry } from './core/registry.js';
import {
  evaluateCapabilityDiscovery,
  type DiscoveryDecision,
  isDestructiveCapabilityExposed,
  type CapabilitySurfaceExposure,
} from './discovery.js';

export type WebMcpTool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations?: Readonly<Record<string, boolean>>;
  readonly execute: (
    input: unknown,
    options: { readonly signal: AbortSignal },
  ) => unknown | Promise<unknown>;
};

export interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: { readonly signal?: AbortSignal }): Promise<void>;
}

export type BrowserDocumentLike = Pick<Document, 'defaultView'> & {
  readonly modelContext?: WebMcpModelContext;
};

export type BrowserExecutionContext = {
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
};

export type BrowserAdapterOptions = {
  readonly surfaceExposure?: CapabilitySurfaceExposure;
  readonly canExpose?: (
    definition: CapabilityDefinition<unknown, unknown>,
  ) => boolean | Promise<boolean>;
  readonly resolveExecutionContext?: () =>
    | BrowserExecutionContext
    | Promise<BrowserExecutionContext>;
};

export type BrowserSkippedTool = {
  readonly capabilityId: string;
  readonly reason:
    | 'no-browser-binding'
    | 'ambiguous-browser-binding'
    | 'name-too-long'
    | 'policy-denied'
    | 'registration-failed';
};

export type BrowserSyncReport = {
  readonly supported: boolean;
  readonly registered: readonly string[];
  readonly skipped: readonly BrowserSkippedTool[];
};

export interface BrowserCapabilityAdapter {
  readonly supported: boolean;
  sync(registry: CapabilityRegistry, options?: BrowserAdapterOptions): Promise<BrowserSyncReport>;
  dispose(): void;
}

type SafeError = { readonly ok: false; readonly error: string };

type ExecuteSuccess = { ok: true; capabilityId: string; value: unknown };

type AbortListener = { readonly signal: AbortSignal; readonly listener: () => void };

let adapters: WeakMap<object, BrowserCapabilityAdapter> = new WeakMap();

function defaultContext(): BrowserExecutionContext {
  return {
    caller: { kind: 'anonymous' },
    authorization: {
      authorize: (request: AuthorizationRequest): boolean =>
        request.access.kind === 'public' && request.risk === 'read',
    },
  };
}

function toolName(definition: CapabilityDefinition<unknown, unknown>): string | undefined {
  const namespace: string = definition.identity.namespace;
  const name: string = definition.identity.name;
  const result: string =
    'uan.' +
    namespace.length +
    '.' +
    namespace +
    '.' +
    name.length +
    '.' +
    name +
    '.v' +
    definition.identity.majorVersion;
  if (result.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(result)) return undefined;
  return result;
}

function safeErrorMessage(reason: ExecutionFailureKind): string {
  switch (reason) {
    case 'invalid-input':
      return 'Capability input is invalid.';
    case 'unauthorized':
      return 'Capability is not authorized.';
    case 'deadline-exceeded':
      return 'Capability execution was cancelled.';
    case 'invalid-identity':
    case 'capability-missing':
    case 'binding-unavailable':
    case 'binding-ambiguous':
    case 'authorization-error':
    case 'invalid-output':
    case 'handler-failed':
      return 'Capability execution is unavailable.';
    default:
      return assertNever(reason);
  }
}

function safeError(reason: ExecutionFailureKind): SafeError {
  const error: string = safeErrorMessage(reason);
  return { ok: false, error };
}

function linkAbortSignals(signals: readonly AbortSignal[]): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  let controller: AbortController = new AbortController();
  let listeners: AbortListener[] = [];
  for (const signal of signals) {
    const listener: () => void = (): void => controller.abort(signal.reason);
    if (signal.aborted) {
      listener();
      break;
    }
    signal.addEventListener('abort', listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose(): void {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

class BrowserAdapter implements BrowserCapabilityAdapter {
  readonly supported: boolean;
  private controller: AbortController | undefined;
  private tail: Promise<void> = Promise.resolve();
  private disposed: boolean = false;
  private readonly onPageHide: EventListener;
  private readonly lifecycleTarget:
    | Pick<Window, 'addEventListener' | 'removeEventListener'>
    | undefined;

  constructor(private readonly document: BrowserDocumentLike) {
    this.supported = typeof document.modelContext?.registerTool === 'function';
    this.lifecycleTarget = document.defaultView ?? undefined;
    this.onPageHide = (): void => this.dispose();
    this.lifecycleTarget?.addEventListener('pagehide', this.onPageHide, { once: true });
  }

  sync(
    registry: CapabilityRegistry,
    options: BrowserAdapterOptions = {},
  ): Promise<BrowserSyncReport> {
    if (this.disposed) throw new Error('Browser capability adapter has been disposed.');
    const modelContext: WebMcpModelContext | undefined = this.document.modelContext;
    if (!this.supported || modelContext === undefined) {
      return Promise.resolve({ supported: false, registered: [], skipped: [] });
    }

    this.controller?.abort();
    let controller: AbortController = new AbortController();
    this.controller = controller;
    const pending: Promise<BrowserSyncReport> = this.tail.then(
      async (): Promise<BrowserSyncReport> => {
        if (this.disposed || this.controller !== controller) {
          return { supported: true, registered: [], skipped: [] };
        }
        let registered: string[] = [];
        let skipped: BrowserSkippedTool[] = [];
        for (const definition of registry.definitions) {
          const capabilityId: string = canonicalCapabilityId(definition.identity);
          const bindings: readonly CapabilityBinding[] = registry.bindings.filter(
            (binding: CapabilityBinding): boolean =>
              binding.capabilityId === capabilityId && binding.targets.includes('browser'),
          );
          if (bindings.length === 0) {
            skipped.push({ capabilityId, reason: 'no-browser-binding' });
            continue;
          }
          if (bindings.length !== 1) {
            skipped.push({ capabilityId, reason: 'ambiguous-browser-binding' });
            continue;
          }
          const binding: CapabilityBinding | undefined = bindings[0];
          if (binding === undefined) continue;

          const tool: string | undefined = toolName(definition);
          if (tool === undefined) {
            skipped.push({ capabilityId, reason: 'name-too-long' });
            continue;
          }

          const discovery: DiscoveryDecision = await evaluateCapabilityDiscovery(
            definition,
            'browser',
            options.surfaceExposure,
            options.canExpose,
          );
          const exposed: boolean = discovery.visible;
          if (!exposed) {
            skipped.push({ capabilityId, reason: 'policy-denied' });
            continue;
          }

          try {
            const inputSchema: Readonly<Record<string, unknown>> = definition.input.toJSONSchema();
            await modelContext.registerTool(
              {
                name: tool,
                title: capabilityId,
                description: definition.description,
                inputSchema,
                annotations: {
                  readOnlyHint: definition.risk === 'read',
                  consequentialHint: definition.risk === 'destructive',
                },
                execute: async (
                  input: unknown,
                  execution: { readonly signal: AbortSignal },
                ): Promise<SafeError | ExecuteSuccess> => {
                  const linked: { readonly signal: AbortSignal; dispose(): void } =
                    linkAbortSignals([controller.signal, execution.signal]);
                  try {
                    if (linked.signal.aborted) return safeError('deadline-exceeded');
                    if (
                      !isDestructiveCapabilityExposed(
                        definition,
                        'browser',
                        options.surfaceExposure,
                      )
                    ) {
                      return safeError('unauthorized');
                    }
                    let context: BrowserExecutionContext;
                    try {
                      context = (await options.resolveExecutionContext?.()) ?? defaultContext();
                    } catch {
                      return safeError('authorization-error');
                    }
                    if (linked.signal.aborted) return safeError('deadline-exceeded');
                    const result: ExecutionResult = await executeCapability(registry, {
                      identity: definition.identity,
                      runtime: 'browser',
                      bindingId: binding.id,
                      input,
                      caller: context.caller,
                      authorization: context.authorization,
                      signal: linked.signal,
                    });
                    if (result.kind === 'failure') return safeError(result.reason);
                    return {
                      ok: true,
                      capabilityId: result.capabilityId,
                      value: result.value,
                    };
                  } finally {
                    linked.dispose();
                  }
                },
              },
              { signal: controller.signal },
            );
            registered.push(tool);
          } catch {
            if (!controller.signal.aborted) {
              skipped.push({ capabilityId, reason: 'registration-failed' });
            }
            break;
          }
          if (this.controller !== controller) break;
        }
        if (this.controller !== controller) {
          return { supported: true, registered: [], skipped: [] };
        }
        return { supported: true, registered, skipped };
      },
    );
    this.tail = pending.then(
      (): undefined => undefined,
      (): undefined => undefined,
    );
    return pending;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.controller = undefined;
    this.lifecycleTarget?.removeEventListener('pagehide', this.onPageHide);
    adapters.delete(this.document);
  }
}

export function createBrowserCapabilityAdapter(
  document: BrowserDocumentLike,
): BrowserCapabilityAdapter {
  const current: BrowserCapabilityAdapter | undefined = adapters.get(document);
  if (current !== undefined) return current;
  const adapter: BrowserAdapter = new BrowserAdapter(document);
  adapters.set(document, adapter);
  return adapter;
}
