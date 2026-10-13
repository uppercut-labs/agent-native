import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  type CallToolResult,
  createMcpHandler as createOfficialMcpHandler,
  fromJsonSchema,
  getOAuthProtectedResourceMetadataUrl,
  type JsonSchemaType,
  type McpRequestContext,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  type RequestId,
  requireBearerAuth,
  requireScopes,
  type ScopeChallenge,
  type ScopeChallengeHandler,
  type ServerContext,
  type StandardSchemaWithJSON,
  type Tool,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import {
  createGrantAuthorization,
  executionCallerForPrincipal,
  type GrantAuthorizationOptions,
  hasGrantForScopes,
  type TrustedPrincipal,
} from './auth.js';
import { assertNever } from './core/assert-never.js';
import { capabilitySurfaceNames, createCapabilitySurfaceMap } from './core/composition.js';
import {
  type CapabilityDefinition,
  type CapabilityRisk,
  canonicalCapabilityId,
} from './core/contracts.js';
import type { DiagnosticObservation } from './core/diagnostics.js';
import type {
  AuthorizationPort,
  AuthorizationRequest,
  ExecutionCaller,
  ExecutionFailureKind,
  ExecutionResult,
} from './core/executor.js';
import { executeCapability } from './core/executor.js';
import type { CapabilityBinding, CapabilityRegistry } from './core/registry.js';
import {
  type CapabilitySurfaceExposure,
  type DiscoveryDecision,
  evaluateCapabilityDiscovery,
  isDestructiveCapabilityExposed,
} from './discovery.js';
import { PACKAGE_VERSION } from './package-version.js';

const DEFAULT_ENDPOINT: '/mcp' = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES: number = 32 * 1024;
const MAX_REQUEST_BYTES: number = 1024 * 1024;
const DEFAULT_DEADLINE_MS: number = 10_000;
const MAX_DEADLINE_MS: number = 300_000;
// MCP 2025-11-25 tool names: 1 to 128 characters of ASCII letters, digits, underscore, hyphen and dot.
const TOOL_NAME_PATTERN: RegExp = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Why a tool call returned an error. Executor reasons come from the shared executor;
 * the others are adapter outcomes. No input, output, credential or exception text is included.
 */
export type McpToolFailureReason =
  | ExecutionFailureKind
  | 'context-unavailable'
  | 'not-exposed'
  | 'result-not-serializable'
  | 'adapter-error';

export type McpToolFailure = {
  readonly capabilityId: string;
  readonly toolName: string;
  readonly reason: McpToolFailureReason;
  readonly observation?: DiagnosticObservation;
};

export type McpExecutionContext = {
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
};

export type McpToolSecurityScheme =
  | { readonly type: 'noauth' }
  | { readonly type: 'oauth2'; readonly scopes: readonly string[] };

export type McpAdapterOptions = {
  readonly endpoint?: string;
  readonly surfaceExposure?: CapabilitySurfaceExposure;
  readonly maxRequestBytes?: number;
  readonly deadlineMs?: number;
  readonly canDiscover?: (
    definition: CapabilityDefinition<unknown, unknown>,
    request: Request,
  ) => boolean | Promise<boolean>;
  readonly discoverProtected?: (
    definition: CapabilityDefinition<unknown, unknown>,
    request: Request,
    authInfo: AuthInfo,
  ) => boolean | Promise<boolean>;
  readonly bearerAuth?: {
    readonly verifier: OAuthTokenVerifier;
    readonly expectedResource: URL;
    readonly requiredScopes?: readonly string[];
    readonly resourceMetadataUrl?: string;
    // Answer requests without an Authorization header with the SDK's 401 challenge. Defaults to
    // true when no capability is a public read, so hosts are prompted to authenticate instead of
    // receiving an empty tool list.
    readonly required?: boolean;
  };
  // Operator hook for tool calls that end in an error. It runs after the response is decided;
  // a throwing or rejecting hook is ignored.
  readonly onToolFailure?: (failure: McpToolFailure) => void | Promise<void>;
  // Overrides the default collision-free tool name. Names must be unique and match MCP's name rules.
  readonly toolName?: (definition: CapabilityDefinition<unknown, unknown>) => string;
  // Optional per-tool OAuth step-up challenge, before the binding executes. The SDK emits
  // a 403 insufficient_scope with WWW-Authenticate; authorization still checks durable grants.
  readonly toolScopeChallenge?: (
    definition: CapabilityDefinition<unknown, unknown>,
  ) => ScopeChallengeHandler | undefined;
  // Opt-in ChatGPT wire metadata. Discovery and execution authorization still apply.
  readonly toolSecuritySchemes?: (
    definition: CapabilityDefinition<unknown, unknown>,
  ) => readonly McpToolSecurityScheme[] | undefined;
  // Default remains the SDK HTTP 403. Tool-result mode carries the same challenge in _meta.
  readonly toolScopeChallengeMode?: 'http' | 'tool-result';
  // AuthInfo comes from the SDK verifier; issuer/subject/tenant must be supplied by that
  // verifier's trusted metadata, never inferred from request headers or MCP clientInfo.
  readonly resolveTrustedPrincipal?: (
    authInfo: AuthInfo,
  ) => TrustedPrincipal | null | Promise<TrustedPrincipal | null>;
  readonly grantAuthorization?: Omit<GrantAuthorizationOptions, 'principal'>;
  readonly resolveExecutionContext?: (
    request: Request,
    authInfo?: AuthInfo,
  ) => McpExecutionContext | Promise<McpExecutionContext>;
};

export type McpAppResourceDefinition = {
  readonly capabilityId: string;
  readonly uri: string;
  readonly name: string;
  readonly html: string;
};

export interface McpAppRegistration {
  readonly resources: readonly McpAppResourceDefinition[];
  readonly registerTool: (
    server: McpServer,
    name: string,
    config: {
      readonly description: string;
      readonly inputSchema: ReturnType<typeof sdkSchema>;
      readonly outputSchema: ReturnType<typeof sdkSchema>;
      readonly annotations: ToolAnnotations;
      readonly scopeChallenge?: ScopeChallengeHandler;
    },
    handler: (input: unknown, context: ServerContext) => Promise<CallToolResult>,
    resourceUri: string,
  ) => void;
  readonly registerResources: (
    server: McpServer,
    resources: readonly McpAppResourceDefinition[],
  ) => void;
}

function validateEndpoint(value: string = DEFAULT_ENDPOINT): string {
  if (
    !value.startsWith('/') ||
    value === '/' ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.split('/').some((part: string): boolean => part === '.' || part === '..') ||
    !value
      .slice(1)
      .split('/')
      .every((segment: string): boolean =>
        Array.from(segment).every((character: string): boolean =>
          /[A-Za-z0-9._~-]/.test(character),
        ),
      )
  ) {
    throw new TypeError(
      'endpoint must be an absolute URL path without query or traversal segments',
    );
  }
  return value;
}

type McpToolConfig = {
  description: string;
  inputSchema: StandardSchemaWithJSON<unknown, unknown>;
  outputSchema: StandardSchemaWithJSON<unknown, unknown>;
  annotations: { idempotentHint?: boolean; readOnlyHint: boolean; destructiveHint: boolean };
  scopeChallenge?: ScopeChallengeHandler;
};

type McpAdapterConfig = {
  readonly endpoint: string;
  readonly maxRequestBytes: number;
  readonly deadlineMs: number;
};

type ToolTextContent = { type: 'text'; text: string };

type ToolErrorResult = {
  content: ToolTextContent[];
  isError: boolean;
  _meta?: { 'mcp/www_authenticate': string[] };
};

type ToolSuccessResult = {
  content: ToolTextContent[];
  structuredContent: { result: unknown };
};

type TimeoutOutcome = { readonly kind: 'timeout' };

type UnavailableOutcome = { readonly kind: 'unavailable' };

type CompleteOutcome = { readonly kind: 'complete'; readonly result: ExecutionResult };

type OperationOutcome = UnavailableOutcome | CompleteOutcome;

function validateOptions(options: McpAdapterOptions): McpAdapterConfig {
  const endpoint: string = validateEndpoint(options.endpoint);
  const maxRequestBytes: number = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const deadlineMs: number = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  if (
    !Number.isSafeInteger(maxRequestBytes) ||
    maxRequestBytes < 1 ||
    maxRequestBytes > MAX_REQUEST_BYTES
  ) {
    throw new RangeError('maxRequestBytes must be between 1 and 1048576');
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_DEADLINE_MS) {
    throw new RangeError('deadlineMs must be between 1 and 300000');
  }
  if (
    (options.resolveTrustedPrincipal !== undefined || options.grantAuthorization !== undefined) &&
    options.bearerAuth === undefined
  ) {
    throw new TypeError('trusted principal resolution requires the official bearer auth gate');
  }
  if (
    (options.resolveTrustedPrincipal === undefined) !==
    (options.grantAuthorization === undefined)
  ) {
    throw new TypeError(
      'trusted principal resolution and grant authorization must be configured together',
    );
  }
  if (
    options.discoverProtected !== undefined &&
    (options.bearerAuth === undefined ||
      options.resolveTrustedPrincipal === undefined ||
      options.grantAuthorization === undefined)
  ) {
    throw new TypeError('protected discovery requires verified principals and grant authorization');
  }
  if (
    options.resolveExecutionContext !== undefined &&
    (options.resolveTrustedPrincipal !== undefined || options.grantAuthorization !== undefined)
  ) {
    throw new TypeError('custom execution context cannot be combined with grant authorization');
  }
  return { endpoint, maxRequestBytes, deadlineMs };
}

function isPublicRead(definition: CapabilityDefinition<unknown, unknown>): boolean {
  return definition.risk === 'read' && definition.access.kind === 'public';
}

function serverBindingsFor(
  registry: CapabilityRegistry,
  definition: CapabilityDefinition<unknown, unknown>,
): readonly CapabilityBinding[] {
  return registry.bindings.filter(
    (binding: CapabilityBinding): boolean =>
      binding.capabilityId === canonicalCapabilityId(definition.identity) &&
      binding.targets.includes('server'),
  );
}

function resolveToolNames(
  registry: CapabilityRegistry,
  options: McpAdapterOptions,
): ReadonlyMap<string, string> {
  const names: Map<string, string> = new Map();
  const used: Set<string> = new Set();
  for (const definition of registry.definitions) {
    const name: string =
      options.toolName === undefined
        ? mcpToolName(definition.identity)
        : options.toolName(definition);
    if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
      throw new TypeError('toolName must return 1 to 128 characters of A-Z, a-z, 0-9, _, - or .');
    }
    if (used.has(name)) throw new TypeError('toolName must return a unique name per capability');
    used.add(name);
    names.set(canonicalCapabilityId(definition.identity), name);
  }
  return names;
}

function reportFailure(options: McpAdapterOptions, failure: McpToolFailure): void {
  if (options.onToolFailure === undefined) return;
  try {
    const pending: void | Promise<void> = options.onToolFailure(Object.freeze(failure));
    if (pending instanceof Promise) pending.catch((): void => undefined);
  } catch {
    // The hook is diagnostic only; it must not change the tool result.
  }
}

export function mcpToolName(identity: CapabilityDefinition<unknown, unknown>['identity']): string {
  return capabilitySurfaceNames(identity).mcp;
}

function sdkSchema(
  schema: Readonly<Record<string, unknown>>,
): StandardSchemaWithJSON<unknown, unknown> {
  // The Workerd validator annotates nested schemas, so give the SDK its own mutable JSON copy.
  return fromJsonSchema(JSON.parse(JSON.stringify(schema)) as JsonSchemaType);
}

function resultSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    type: 'object',
    properties: { result: schema },
    required: ['result'],
    additionalProperties: false,
  };
}

function toolError(message: string): ToolErrorResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

function deadlineToolError(risk: CapabilityRisk): ToolErrorResult {
  return toolError(
    risk === 'read'
      ? 'Capability execution exceeded its deadline.'
      : 'Capability execution exceeded its deadline; the write may have completed. Do not retry without checking its state.',
  );
}

function executorError(reason: ExecutionFailureKind): string {
  switch (reason) {
    case 'capability-missing':
    case 'invalid-identity':
    case 'unauthorized':
      return 'Capability not found.';
    case 'invalid-input':
      return 'Capability input is invalid.';
    case 'binding-unavailable':
    case 'binding-ambiguous':
    case 'authorization-error':
    case 'invalid-output':
    case 'handler-failed':
    case 'deadline-exceeded':
      return 'Capability execution is unavailable.';
    default:
      return assertNever(reason);
  }
}

function defaultContext(): McpExecutionContext {
  return {
    caller: { kind: 'anonymous' },
    authorization: {
      authorize: (request: AuthorizationRequest): boolean =>
        request.risk === 'read' && request.access.kind === 'public',
    },
  };
}

async function defineServer(
  registry: CapabilityRegistry,
  requestInfo: Request | undefined,
  authInfo: AuthInfo | undefined,
  options: McpAdapterOptions,
  deadlineMs: number,
  toolNames: ReadonlyMap<string, string>,
  appRegistration?: McpAppRegistration,
): Promise<McpServer> {
  const server: McpServer = new McpServer({
    name: 'uppercut-agent-native',
    version: PACKAGE_VERSION,
  });
  if (requestInfo === undefined) return server;
  let visibleAppResources: Map<string, McpAppResourceDefinition> = new Map();
  const listedTools: (Tool & { securitySchemes?: readonly McpToolSecurityScheme[] })[] = [];

  for (const definition of registry.definitions) {
    const serverBindings: readonly CapabilityBinding[] = serverBindingsFor(registry, definition);
    if (serverBindings.length !== 1) continue;
    const publicRead: boolean = isPublicRead(definition);
    const discovery: DiscoveryDecision = await evaluateCapabilityDiscovery(
      definition,
      'mcp',
      options.surfaceExposure,
      publicRead
        ? async (candidate: CapabilityDefinition<unknown, unknown>): Promise<boolean> =>
            (await options.canDiscover?.(candidate, requestInfo)) ?? true
        : async (candidate: CapabilityDefinition<unknown, unknown>): Promise<boolean> => {
            const auth: Omit<GrantAuthorizationOptions, 'principal'> | undefined =
              options.grantAuthorization;
            const principal: TrustedPrincipal | null =
              authInfo === undefined || options.resolveTrustedPrincipal === undefined
                ? null
                : await options.resolveTrustedPrincipal(authInfo);
            if (
              principal === null ||
              authInfo === undefined ||
              auth === undefined ||
              auth.store === undefined ||
              candidate.access.kind !== 'protected'
            )
              return false;
            const hasGrant: boolean = await hasGrantForScopes({
              principal,
              applicationId: auth.applicationId,
              audience: auth.audience,
              policyRevision: auth.policyRevision,
              store: auth.store,
              requiredScopes: candidate.access.scopes,
              ...(auth.now === undefined ? {} : { now: auth.now }),
            });
            if (!hasGrant || options.discoverProtected === undefined) return false;
            return await options.discoverProtected(candidate, requestInfo, authInfo);
          },
    );
    // A known protected name may return a scope prompt, but cannot run or appear in discovery
    // without a grant. Unexposed destructive and unbound capabilities remain absent.
    const canPromptHidden: boolean =
      !discovery.visible &&
      authInfo !== undefined &&
      definition.access.kind === 'protected' &&
      isDestructiveCapabilityExposed(definition, 'mcp', options.surfaceExposure) &&
      options.toolSecuritySchemes !== undefined &&
      options.toolScopeChallengeMode === 'tool-result';
    if (!discovery.visible && !canPromptHidden) continue;
    const scopeChallenge: ScopeChallengeHandler | undefined =
      options.toolScopeChallenge?.(definition);
    if (!discovery.visible && scopeChallenge === undefined) continue;
    const capabilityId: string = canonicalCapabilityId(definition.identity);
    const name: string = toolNames.get(capabilityId) ?? mcpToolName(definition.identity);
    const fail = (
      reason: McpToolFailureReason,
      result: ToolErrorResult,
      observation?: DiagnosticObservation,
    ): ToolErrorResult => {
      reportFailure(options, {
        capabilityId,
        toolName: name,
        reason,
        ...(observation === undefined ? {} : { observation }),
      });
      return result;
    };
    const inputSchema: StandardSchemaWithJSON<unknown, unknown> = sdkSchema(
      definition.input.toJSONSchema(),
    );
    const outputSchema: StandardSchemaWithJSON<unknown, unknown> = sdkSchema(
      resultSchema(definition.output.toJSONSchema()),
    );
    const toolResultChallenges: Map<RequestId, ScopeChallenge | undefined> = new Map();
    const toolConfig: McpToolConfig = {
      ...(scopeChallenge === undefined
        ? {}
        : {
            scopeChallenge:
              options.toolScopeChallengeMode === 'tool-result'
                ? async (context) => {
                    // Preserve the SDK's actual request/auth context; this server is request-scoped.
                    const challenge: ScopeChallenge | undefined = await scopeChallenge(context);
                    if (challenge !== undefined) {
                      // Returning undefined bypasses SDK challenge validation, so validate here.
                      requireScopes(...challenge.scopes);
                      if (
                        challenge.errorDescription !== undefined &&
                        !/^[\u0020-\u0021\u0023-\u005B\u005D-\u007E]+$/.test(
                          challenge.errorDescription,
                        )
                      ) {
                        throw new TypeError(
                          'Scope challenge errorDescription must satisfy RFC 6750.',
                        );
                      }
                    }
                    toolResultChallenges.set(context.request.id, challenge);
                    return undefined;
                  }
                : scopeChallenge,
          }),
      description: `${definition.description} Returns the contract value under structuredContent.result.`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: definition.risk === 'read',
        destructiveHint: definition.risk === 'destructive',
        ...(definition.risk === 'read' ? { idempotentHint: true } : {}),
      },
    };
    const appResource: McpAppResourceDefinition | undefined = discovery.visible
      ? appRegistration?.resources.find(
          (resource: McpAppResourceDefinition): boolean =>
            resource.capabilityId === canonicalCapabilityId(definition.identity),
        )
      : undefined;
    if (appResource !== undefined) visibleAppResources.set(appResource.uri, appResource);
    if (discovery.visible && options.toolSecuritySchemes !== undefined) {
      const securitySchemes = options.toolSecuritySchemes(definition);
      const schema = definition.input.toJSONSchema();
      if (schema['type'] !== 'object') {
        throw new TypeError('MCP tool input schema must have an object root.');
      }
      listedTools.push({
        name,
        description: toolConfig.description,
        inputSchema: { ...schema, type: 'object' },
        outputSchema: { ...resultSchema(definition.output.toJSONSchema()), type: 'object' },
        annotations: toolConfig.annotations,
        ...(securitySchemes === undefined ? {} : { securitySchemes }),
        _meta: {
          ...(securitySchemes === undefined ? {} : { securitySchemes }),
          ...(appResource === undefined
            ? {}
            : { ui: { resourceUri: appResource.uri, visibility: ['model', 'app'] } }),
        },
      });
    }
    const toolHandler = async (
      input: unknown,
      context: ServerContext,
    ): Promise<ToolErrorResult | ToolSuccessResult> => {
      if (!isDestructiveCapabilityExposed(definition, 'mcp', options.surfaceExposure)) {
        return fail('not-exposed', toolError('Capability not found.'));
      }
      if (options.toolScopeChallengeMode === 'tool-result' && scopeChallenge !== undefined) {
        if (!toolResultChallenges.has(context.mcpReq.id)) {
          throw new Error('OAuth scope challenge context was not resolved.');
        }
        const challenge: ScopeChallenge | undefined = toolResultChallenges.get(context.mcpReq.id);
        if (challenge !== undefined) {
          const description: string =
            challenge.errorDescription ?? 'Additional permission required.';
          const resourceMetadataUrl: string | undefined =
            authInfo?.resourceMetadataUrl ??
            options.bearerAuth?.resourceMetadataUrl ??
            (options.bearerAuth?.expectedResource === undefined
              ? undefined
              : getOAuthProtectedResourceMetadataUrl(options.bearerAuth.expectedResource));
          const response: Response = bearerAuthChallengeResponse(
            new OAuthError(OAuthErrorCode.InsufficientScope, description),
            {
              requiredScopes: [...challenge.scopes],
              ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
            },
          );
          const header: string | null = response.headers.get('www-authenticate');
          if (header === null) throw new Error('OAuth scope challenge has no WWW-Authenticate.');
          return fail('unauthorized', {
            ...toolError(description),
            _meta: { 'mcp/www_authenticate': [header] },
          });
        }
      }
      if (!discovery.visible) return fail('not-exposed', toolError('Capability not found.'));
      let controller: AbortController = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout: Promise<TimeoutOutcome> = new Promise<TimeoutOutcome>(
        (resolve: (value: TimeoutOutcome) => void): void => {
          timer = setTimeout((): void => {
            controller.abort();
            resolve({ kind: 'timeout' });
          }, deadlineMs);
        },
      );
      const operation: Promise<OperationOutcome> = (async (): Promise<OperationOutcome> => {
        let context: McpExecutionContext;
        try {
          if (options.resolveExecutionContext !== undefined) {
            context = await options.resolveExecutionContext(requestInfo, authInfo);
          } else {
            const principal: TrustedPrincipal | null =
              authInfo === undefined || options.resolveTrustedPrincipal === undefined
                ? null
                : await options.resolveTrustedPrincipal(authInfo);
            context = {
              caller:
                principal === null ? { kind: 'anonymous' } : executionCallerForPrincipal(principal),
              authorization:
                options.grantAuthorization === undefined
                  ? defaultContext().authorization
                  : createGrantAuthorization({
                      ...options.grantAuthorization,
                      principal,
                    }),
            };
          }
        } catch {
          return { kind: 'unavailable' as const };
        }
        const result: ExecutionResult = await executeCapability(registry, {
          identity: definition.identity,
          runtime: 'server',
          input,
          caller: context.caller,
          authorization: context.authorization,
          signal: controller.signal,
        });
        return { kind: 'complete' as const, result };
      })();

      try {
        const outcome: TimeoutOutcome | OperationOutcome = await Promise.race([operation, timeout]);
        if (outcome.kind === 'timeout')
          return fail('deadline-exceeded', deadlineToolError(definition.risk));
        if (outcome.kind === 'unavailable')
          return fail('context-unavailable', toolError('Capability execution is unavailable.'));
        if (outcome.result.kind === 'failure')
          return fail(
            outcome.result.reason,
            outcome.result.reason === 'deadline-exceeded'
              ? deadlineToolError(definition.risk)
              : toolError(executorError(outcome.result.reason)),
            outcome.result.observation,
          );
        const value: unknown = outcome.result.value;
        let valueJson: string | undefined;
        try {
          if (typeof value === 'number' && !Number.isFinite(value))
            return fail(
              'result-not-serializable',
              toolError('Capability result could not be serialized.'),
            );
          valueJson = JSON.stringify(value);
        } catch {
          return fail(
            'result-not-serializable',
            toolError('Capability result could not be serialized.'),
          );
        }
        if (valueJson === undefined)
          return fail(
            'result-not-serializable',
            toolError('Capability result could not be serialized.'),
          );

        const structuredContent: { result: unknown } = { result: JSON.parse(valueJson) as unknown };
        const text: string = JSON.stringify(structuredContent);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      } catch {
        return fail('adapter-error', toolError('Capability execution is unavailable.'));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };
    if (appResource === undefined || appRegistration === undefined) {
      server.registerTool(name, toolConfig, toolHandler);
    } else {
      appRegistration.registerTool(server, name, toolConfig, toolHandler, appResource.uri);
    }
  }
  if (visibleAppResources.size > 0 && appRegistration !== undefined) {
    appRegistration.registerResources(server, [...visibleAppResources.values()]);
  }
  // SDK 2.3.0 drops root securitySchemes from registration. Use its supported low-level
  // list handler; keep the SDK call handler for validation, transport and result projection.
  if (options.toolSecuritySchemes !== undefined) {
    server.server.setRequestHandler('tools/list', () => ({ tools: listedTools }));
  }
  return server;
}

export function createMcpHandler(
  registry: CapabilityRegistry,
  options: McpAdapterOptions = {},
): (request: Request) => Promise<Response> {
  return createMcpHandlerWithAppRegistration(registry, options);
}

export function createMcpHandlerWithAppRegistration(
  registry: CapabilityRegistry,
  options: McpAdapterOptions = {},
  appRegistration?: McpAppRegistration,
): (request: Request) => Promise<Response> {
  createCapabilitySurfaceMap(registry.definitions);
  const config: McpAdapterConfig = validateOptions(options);
  const toolNames: ReadonlyMap<string, string> = resolveToolNames(registry, options);
  const hasPublicRead: boolean = registry.definitions.some(
    (definition: CapabilityDefinition<unknown, unknown>): boolean =>
      isPublicRead(definition) && serverBindingsFor(registry, definition).length === 1,
  );
  const authenticationRequired: boolean =
    options.bearerAuth !== undefined && (options.bearerAuth.required ?? !hasPublicRead);
  const officialHandler: ReturnType<typeof createOfficialMcpHandler> = createOfficialMcpHandler(
    async (context: McpRequestContext): Promise<McpServer> =>
      await defineServer(
        registry,
        context.requestInfo,
        context.authInfo,
        options,
        config.deadlineMs,
        toolNames,
        appRegistration,
      ),
    {
      legacy: 'stateless',
      maxRequestBodySize: config.maxRequestBytes,
    },
  );

  const bearerGate: ((request: Request) => Promise<AuthInfo | Response>) | undefined =
    options.bearerAuth === undefined
      ? undefined
      : requireBearerAuth({
          verifier: options.bearerAuth.verifier,
          expectedResource: options.bearerAuth.expectedResource,
          ...(options.bearerAuth.requiredScopes === undefined
            ? {}
            : { requiredScopes: [...options.bearerAuth.requiredScopes] }),
          ...(options.bearerAuth.resourceMetadataUrl === undefined
            ? {}
            : { resourceMetadataUrl: options.bearerAuth.resourceMetadataUrl }),
        });

  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== config.endpoint) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    let authInfo: AuthInfo | undefined;
    if (
      bearerGate !== undefined &&
      (authenticationRequired || request.headers.has('authorization'))
    ) {
      const gated: Response | AuthInfo = await bearerGate(request);
      if (gated instanceof Response) return gated;
      authInfo = gated;
    }
    return officialHandler.fetch(request, authInfo === undefined ? {} : { authInfo });
  };
}
