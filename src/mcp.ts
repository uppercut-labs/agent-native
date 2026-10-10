import {
  type AuthInfo,
  type CallToolResult,
  createMcpHandler as createOfficialMcpHandler,
  fromJsonSchema,
  type JsonSchemaType,
  type McpRequestContext,
  McpServer,
  type OAuthTokenVerifier,
  requireBearerAuth,
  type StandardSchemaWithJSON,
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
  evaluateCapabilityDiscovery,
  type DiscoveryDecision,
  isDestructiveCapabilityExposed,
} from './discovery.js';
import { PACKAGE_VERSION } from './package-version.js';

const DEFAULT_ENDPOINT: '/mcp' = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES: number = 32 * 1024;
const MAX_REQUEST_BYTES: number = 1024 * 1024;
const DEFAULT_DEADLINE_MS: number = 10_000;
const MAX_DEADLINE_MS: number = 300_000;

export type McpExecutionContext = {
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
};

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
  };
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
    },
    handler: (input: unknown) => Promise<CallToolResult>,
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
  appRegistration?: McpAppRegistration,
): Promise<McpServer> {
  const server: McpServer = new McpServer({
    name: 'uppercut-agent-native',
    version: PACKAGE_VERSION,
  });
  if (requestInfo === undefined) return server;
  let visibleAppResources: Map<string, McpAppResourceDefinition> = new Map();

  for (const definition of registry.definitions) {
    const serverBindings: readonly CapabilityBinding[] = registry.bindings.filter(
      (binding: CapabilityBinding): boolean =>
        binding.capabilityId === canonicalCapabilityId(definition.identity) &&
        binding.targets.includes('server'),
    );
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
    if (!discovery.visible) continue;
    const name: string = mcpToolName(definition.identity);
    const inputSchema: StandardSchemaWithJSON<unknown, unknown> = sdkSchema(
      definition.input.toJSONSchema(),
    );
    const outputSchema: StandardSchemaWithJSON<unknown, unknown> = sdkSchema(
      resultSchema(definition.output.toJSONSchema()),
    );
    const toolConfig: McpToolConfig = {
      description: `${definition.description} Returns the contract value under structuredContent.result.`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: definition.risk === 'read',
        destructiveHint: definition.risk === 'destructive',
        ...(definition.risk === 'read' ? { idempotentHint: true } : {}),
      },
    };
    const appResource: McpAppResourceDefinition | undefined = appRegistration?.resources.find(
      (resource: McpAppResourceDefinition): boolean =>
        resource.capabilityId === canonicalCapabilityId(definition.identity),
    );
    if (appResource !== undefined) visibleAppResources.set(appResource.uri, appResource);
    const toolHandler: (input: unknown) => Promise<ToolErrorResult | ToolSuccessResult> = async (
      input: unknown,
    ): Promise<ToolErrorResult | ToolSuccessResult> => {
      if (!isDestructiveCapabilityExposed(definition, 'mcp', options.surfaceExposure)) {
        return toolError('Capability not found.');
      }
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
        if (outcome.kind === 'timeout') return deadlineToolError(definition.risk);
        if (outcome.kind === 'unavailable')
          return toolError('Capability execution is unavailable.');
        if (outcome.result.kind === 'failure')
          return outcome.result.reason === 'deadline-exceeded'
            ? deadlineToolError(definition.risk)
            : toolError(executorError(outcome.result.reason));
        const value: unknown = outcome.result.value;
        let valueJson: string | undefined;
        try {
          if (typeof value === 'number' && !Number.isFinite(value))
            return toolError('Capability result could not be serialized.');
          valueJson = JSON.stringify(value);
        } catch {
          return toolError('Capability result could not be serialized.');
        }
        if (valueJson === undefined) return toolError('Capability result could not be serialized.');

        const structuredContent: { result: unknown } = { result: JSON.parse(valueJson) as unknown };
        const text: string = JSON.stringify(structuredContent);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      } catch {
        return toolError('Capability execution is unavailable.');
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
  const officialHandler: ReturnType<typeof createOfficialMcpHandler> = createOfficialMcpHandler(
    async (context: McpRequestContext): Promise<McpServer> =>
      await defineServer(
        registry,
        context.requestInfo,
        context.authInfo,
        options,
        config.deadlineMs,
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
    if (bearerGate !== undefined && request.headers.has('authorization')) {
      const gated: Response | AuthInfo = await bearerGate(request);
      if (gated instanceof Response) return gated;
      authInfo = gated;
    }
    return officialHandler.fetch(request, authInfo === undefined ? {} : { authInfo });
  };
}
