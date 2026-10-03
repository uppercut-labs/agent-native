import {
  createMcpHandler as createOfficialMcpHandler,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
  type McpRequestContext,
  type AuthInfo,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import {
  createGrantAuthorization,
  executionCallerForPrincipal,
  type GrantAuthorizationOptions,
  type TrustedPrincipal,
} from './auth.js';
import type { AuthorizationPort, ExecutionCaller } from './core/executor.js';
import { executeCapability } from './core/executor.js';
import { canonicalCapabilityId, type CapabilityDefinition } from './core/contracts.js';
import type { CapabilityRegistry } from './core/registry.js';

const DEFAULT_ENDPOINT = '/mcp';
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_DEADLINE_MS = 10_000;
const MAX_DEADLINE_MS = 300_000;
const SERVER_VERSION = '0.0.0';

export type McpExecutionContext = {
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
};

export type McpAdapterOptions = {
  readonly endpoint?: string;
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

function validateEndpoint(value = DEFAULT_ENDPOINT): string {
  if (
    !value.startsWith('/') ||
    value === '/' ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.split('/').some((part) => part === '.' || part === '..') ||
    !value
      .slice(1)
      .split('/')
      .every((segment) =>
        Array.from(segment).every((character) => /[A-Za-z0-9._~-]/.test(character)),
      )
  ) {
    throw new TypeError(
      'endpoint must be an absolute URL path without query or traversal segments',
    );
  }
  return value;
}

function validateOptions(options: McpAdapterOptions) {
  const endpoint = validateEndpoint(options.endpoint);
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
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
  const id = canonicalCapabilityId(identity);
  const colon = id.indexOf(':');
  const at = id.lastIndexOf('@');
  const namespace = id.slice(0, colon);
  const name = id.slice(colon + 1, at);
  return (
    'cap_' +
    namespace.length +
    '_' +
    namespace +
    '_' +
    name.length +
    '_' +
    name +
    '_v' +
    id.slice(at + 1)
  );
}

function sdkSchema(schema: Readonly<Record<string, unknown>>) {
  // SchemaPort emits JSON Schema; this is the single conversion boundary into the official SDK.
  return fromJsonSchema(schema as JsonSchemaType);
}

function resultSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    type: 'object',
    properties: { result: schema },
    required: ['result'],
    additionalProperties: false,
  };
}

function toolError(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

function executorError(reason: string): string {
  switch (reason) {
    case 'capability-missing':
    case 'invalid-identity':
    case 'unauthorized':
      return 'Capability not found.';
    case 'invalid-input':
      return 'Capability input is invalid.';
    default:
      return 'Capability execution is unavailable.';
  }
}

function defaultContext(): McpExecutionContext {
  return {
    caller: { kind: 'anonymous' },
    authorization: {
      authorize: (request) => request.risk === 'read' && request.access.kind === 'public',
    },
  };
}

async function defineServer(
  registry: CapabilityRegistry,
  requestInfo: Request | undefined,
  authInfo: AuthInfo | undefined,
  options: McpAdapterOptions,
  deadlineMs: number,
): Promise<McpServer> {
  const server = new McpServer({ name: 'uppercut-agent-native', version: SERVER_VERSION });
  if (requestInfo === undefined) return server;

  for (const definition of registry.definitions) {
    const publicRead = isPublicRead(definition);
    if (!publicRead && (options.discoverProtected === undefined || authInfo === undefined))
      continue;
    let visible = publicRead;
    try {
      visible = publicRead
        ? ((await options.canDiscover?.(definition, requestInfo)) ?? true)
        : options.discoverProtected === undefined
          ? false
          : await options.discoverProtected(definition, requestInfo, authInfo!);
    } catch {
      visible = false;
    }
    if (!visible) continue;
    const name = mcpToolName(definition.identity);
    const inputSchema = sdkSchema(definition.input.toJSONSchema());
    const outputSchema = sdkSchema(resultSchema(definition.output.toJSONSchema()));
    server.registerTool(
      name,
      {
        description:
          definition.description + ' Returns the contract value under structuredContent.result.',
        inputSchema,
        outputSchema,
        annotations: {
          readOnlyHint: definition.risk === 'read',
          destructiveHint: definition.risk === 'destructive',
          ...(definition.risk === 'read' ? { idempotentHint: true } : {}),
        },
      },
      async (input) => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{ readonly kind: 'timeout' }>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ kind: 'timeout' });
          }, deadlineMs);
        });
        const operation = (async () => {
          let context: McpExecutionContext;
          try {
            if (options.resolveExecutionContext !== undefined) {
              context = await options.resolveExecutionContext(requestInfo, authInfo);
            } else {
              const principal =
                authInfo === undefined || options.resolveTrustedPrincipal === undefined
                  ? null
                  : await options.resolveTrustedPrincipal(authInfo);
              context = {
                caller:
                  principal === null
                    ? { kind: 'anonymous' }
                    : executionCallerForPrincipal(principal),
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
          const result = await executeCapability(registry, {
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
          const outcome = await Promise.race([operation, timeout]);
          if (outcome.kind === 'timeout')
            return toolError('Capability execution exceeded its deadline.');
          if (outcome.kind === 'unavailable')
            return toolError('Capability execution is unavailable.');
          if (outcome.result.kind === 'failure')
            return toolError(executorError(outcome.result.reason));
          const value = outcome.result.value;
          let valueJson: string | undefined;
          try {
            if (typeof value === 'number' && !Number.isFinite(value))
              return toolError('Capability result could not be serialized.');
            valueJson = JSON.stringify(value);
          } catch {
            return toolError('Capability result could not be serialized.');
          }
          if (valueJson === undefined)
            return toolError('Capability result could not be serialized.');

          const structuredContent = { result: JSON.parse(valueJson) as unknown };
          const text = JSON.stringify(structuredContent);
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent,
          };
        } catch {
          return toolError('Capability execution is unavailable.');
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      },
    );
  }
  return server;
}

export function createMcpHandler(
  registry: CapabilityRegistry,
  options: McpAdapterOptions = {},
): (request: Request) => Promise<Response> {
  const config = validateOptions(options);
  const officialHandler = createOfficialMcpHandler(
    async (context: McpRequestContext) =>
      await defineServer(
        registry,
        context.requestInfo,
        context.authInfo,
        options,
        config.deadlineMs,
      ),
    {
      legacy: 'stateless',
      maxRequestBodySize: config.maxRequestBytes,
    },
  );

  const bearerGate =
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
      const gated = await bearerGate(request);
      if (gated instanceof Response) return gated;
      authInfo = gated;
    }
    return officialHandler.fetch(request, authInfo === undefined ? {} : { authInfo });
  };
}
