import {
  createMcpHandler as createOfficialMcpHandler,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
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
  readonly resolveExecutionContext?: (
    request: Request,
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
  options: McpAdapterOptions,
  deadlineMs: number,
): Promise<McpServer> {
  const server = new McpServer({ name: 'uppercut-agent-native', version: SERVER_VERSION });
  if (requestInfo === undefined) return server;

  for (const definition of registry.definitions) {
    if (!isPublicRead(definition)) continue;
    let visible = true;
    try {
      visible = (await options.canDiscover?.(definition, requestInfo)) ?? true;
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
            context = (await options.resolveExecutionContext?.(requestInfo)) ?? defaultContext();
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
      await defineServer(registry, context.requestInfo, options, config.deadlineMs),
    {
      legacy: 'stateless',
      maxRequestBodySize: config.maxRequestBytes,
    },
  );

  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== config.endpoint) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return officialHandler.fetch(request);
  };
}
