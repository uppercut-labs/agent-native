import { canonicalCapabilityId, type CapabilityDefinition } from './core/contracts.js';
import {
  executeCapability,
  type AuthorizationPort,
  type ExecutionCaller,
} from './core/executor.js';
import type { CapabilityRegistry } from './core/registry.js';

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

export type WebMcpModelContext = {
  registerTool(tool: WebMcpTool, options?: { readonly signal?: AbortSignal }): Promise<void>;
};

export type BrowserDocumentLike = Pick<Document, 'defaultView'> & {
  readonly modelContext?: WebMcpModelContext;
};

export type BrowserExecutionContext = {
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
};

export type BrowserAdapterOptions = {
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

export type BrowserCapabilityAdapter = {
  readonly supported: boolean;
  sync(registry: CapabilityRegistry, options?: BrowserAdapterOptions): Promise<BrowserSyncReport>;
  dispose(): void;
};

const adapters = new WeakMap<object, BrowserCapabilityAdapter>();

function defaultContext(): BrowserExecutionContext {
  return {
    caller: { kind: 'anonymous' },
    authorization: {
      authorize: (request) => request.access.kind === 'public' && request.risk === 'read',
    },
  };
}

function toolName(definition: CapabilityDefinition<unknown, unknown>): string | undefined {
  const namespace = definition.identity.namespace;
  const name = definition.identity.name;
  const result =
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

function safeError(reason: string): { readonly ok: false; readonly error: string } {
  const error =
    reason === 'invalid-input'
      ? 'Capability input is invalid.'
      : reason === 'unauthorized'
        ? 'Capability is not authorized.'
        : reason === 'deadline-exceeded'
          ? 'Capability execution was cancelled.'
          : 'Capability execution is unavailable.';
  return { ok: false, error };
}

function linkAbortSignals(signals: readonly AbortSignal[]): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const listeners: Array<{ readonly signal: AbortSignal; readonly listener: () => void }> = [];
  for (const signal of signals) {
    const listener = () => controller.abort(signal.reason);
    if (signal.aborted) {
      listener();
      break;
    }
    signal.addEventListener('abort', listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose() {
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
  private disposed = false;
  private readonly onPageHide: EventListener;
  private readonly lifecycleTarget:
    | Pick<Window, 'addEventListener' | 'removeEventListener'>
    | undefined;

  constructor(private readonly document: BrowserDocumentLike) {
    this.supported = typeof document.modelContext?.registerTool === 'function';
    this.lifecycleTarget = document.defaultView ?? undefined;
    this.onPageHide = () => this.dispose();
    this.lifecycleTarget?.addEventListener('pagehide', this.onPageHide, { once: true });
  }

  sync(
    registry: CapabilityRegistry,
    options: BrowserAdapterOptions = {},
  ): Promise<BrowserSyncReport> {
    if (this.disposed) throw new Error('Browser capability adapter has been disposed.');
    const modelContext = this.document.modelContext;
    if (!this.supported || modelContext === undefined) {
      return Promise.resolve({ supported: false, registered: [], skipped: [] });
    }

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const pending = this.tail.then(async () => {
      if (this.disposed || this.controller !== controller) {
        return { supported: true, registered: [], skipped: [] };
      }
      const registered: string[] = [];
      const skipped: BrowserSkippedTool[] = [];
      for (const definition of registry.definitions) {
        const capabilityId = canonicalCapabilityId(definition.identity);
        const bindings = registry.bindings.filter(
          (binding) => binding.capabilityId === capabilityId && binding.targets.includes('browser'),
        );
        if (bindings.length === 0) {
          skipped.push({ capabilityId, reason: 'no-browser-binding' });
          continue;
        }
        if (bindings.length !== 1) {
          skipped.push({ capabilityId, reason: 'ambiguous-browser-binding' });
          continue;
        }
        const binding = bindings[0];
        if (binding === undefined) continue;

        const tool = toolName(definition);
        if (tool === undefined) {
          skipped.push({ capabilityId, reason: 'name-too-long' });
          continue;
        }

        let exposed: boolean;
        try {
          exposed = await (options.canExpose?.(definition) ??
            (definition.access.kind === 'public' && definition.risk === 'read'));
        } catch {
          exposed = false;
        }
        if (!exposed) {
          skipped.push({ capabilityId, reason: 'policy-denied' });
          continue;
        }

        try {
          const inputSchema = definition.input.toJSONSchema();
          await modelContext.registerTool(
            {
              name: tool,
              title: capabilityId,
              description: definition.description,
              inputSchema,
              annotations: { readOnlyHint: definition.risk === 'read' },
              execute: async (input, execution) => {
                const linked = linkAbortSignals([controller.signal, execution.signal]);
                try {
                  if (linked.signal.aborted) return safeError('deadline-exceeded');
                  let context: BrowserExecutionContext;
                  try {
                    context = (await options.resolveExecutionContext?.()) ?? defaultContext();
                  } catch {
                    return safeError('authorization-error');
                  }
                  if (linked.signal.aborted) return safeError('deadline-exceeded');
                  const result = await executeCapability(registry, {
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
    });
    this.tail = pending.then(
      () => undefined,
      () => undefined,
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
  const current = adapters.get(document);
  if (current !== undefined) return current;
  const adapter = new BrowserAdapter(document);
  adapters.set(document, adapter);
  return adapter;
}
