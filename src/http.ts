import { canonicalCapabilityId, type CapabilityDefinition } from './core/contracts.js';
import type { AuthorizationPort, ExecutionCaller, ExecutionResult } from './core/executor.js';
import { executeCapability } from './core/executor.js';
import type { CapabilityRegistry, ExecutionSignal } from './core/registry.js';
import { createDiagnosticObservation } from './core/diagnostics.js';

const DEFAULT_BASE_PATH = '/agent-native/v1';
const DEFAULT_MAX_BYTES = 32 * 1024;
const DEFAULT_DEADLINE_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_DEADLINE_MS = 300_000;
const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
      additionalProperties: false,
    },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

export type HttpExecutionContext = {
  readonly caller: ExecutionCaller;
  readonly authorization: AuthorizationPort;
};

export type HttpAdapterOptions = {
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
  readonly deadlineMs?: number;
  readonly resolveExecutionContext?: (
    request: Request,
  ) => HttpExecutionContext | Promise<HttpExecutionContext>;
};

function basePath(value = DEFAULT_BASE_PATH): string {
  if (
    !value.startsWith('/') ||
    value === '/' ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    value.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new TypeError(
      'basePath must be an absolute URL path without query or traversal segments',
    );
  }
  let result = value;
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  if (
    result.includes('//') ||
    !result
      .slice(1)
      .split('/')
      .every((segment) =>
        Array.from(segment).every((character) => /[A-Za-z0-9._~-]/.test(character)),
      )
  ) {
    throw new TypeError('basePath contains unsupported path characters');
  }
  return result;
}

function validateOptions(options: HttpAdapterOptions) {
  const root = basePath(options.basePath);
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_BYTES;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  if (
    !Number.isSafeInteger(maxRequestBytes) ||
    maxRequestBytes < 1 ||
    maxRequestBytes > MAX_BODY_BYTES
  ) {
    throw new RangeError('maxRequestBytes must be between 1 and 1048576');
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_DEADLINE_MS) {
    throw new RangeError('deadlineMs must be between 1 and 300000');
  }
  return { root, maxRequestBytes, deadlineMs };
}

export function httpInvocationPath(
  identity: CapabilityDefinition<unknown, unknown>['identity'],
  root = DEFAULT_BASE_PATH,
): string {
  const id = canonicalCapabilityId(identity);
  const colon = id.indexOf(':');
  const at = id.lastIndexOf('@');
  return (
    basePath(root) +
    '/capabilities/' +
    encodeURIComponent(id.slice(0, colon)) +
    '/' +
    encodeURIComponent(id.slice(colon + 1, at)) +
    '/v' +
    id.slice(at + 1) +
    '/invoke'
  );
}

function isPublicRead(definition: CapabilityDefinition<unknown, unknown>): boolean {
  return definition.risk === 'read' && definition.access.kind === 'public';
}

function copySchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    throw new TypeError('schema could not be serialized as JSON');
  }
  if (serialized === undefined) {
    throw new TypeError('schema could not be serialized as JSON');
  }
  const result: unknown = JSON.parse(serialized);
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new TypeError('schema must serialize to an object');
  }
  return result as Record<string, unknown>;
}

function errorContent() {
  return { 'application/json': { schema: copySchema(ERROR_SCHEMA) } };
}

export function createOpenApiDocument(
  registry: CapabilityRegistry,
  options: { readonly basePath?: string } = {},
): Readonly<Record<string, unknown>> {
  const root = basePath(options.basePath);
  const paths: Record<string, unknown> = {};
  for (const definition of registry.definitions.filter(isPublicRead)) {
    const id = canonicalCapabilityId(definition.identity);
    const operationId =
      'invoke_' +
      definition.identity.namespace.length +
      '_' +
      definition.identity.namespace +
      '_' +
      definition.identity.name.length +
      '_' +
      definition.identity.name +
      '_v' +
      definition.identity.majorVersion;
    paths[httpInvocationPath(definition.identity, root)] = {
      post: {
        operationId,
        summary: definition.description,
        description: 'Generic capability invocation, not a REST resource route.',
        'x-agent-native-capability-id': id,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: copySchema(definition.input.toJSONSchema()) },
          },
        },
        responses: {
          '200': {
            description: 'Validated capability result.',
            content: {
              'application/json': { schema: copySchema(definition.output.toJSONSchema()) },
            },
          },
          '400': { description: 'Malformed JSON request body.', content: errorContent() },
          '405': { description: 'Method not allowed for a visible capability path.' },
          '404': {
            description: 'Capability is unavailable or not visible.',
            content: errorContent(),
          },
          '413': {
            description: 'Request body exceeds the configured limit.',
            content: errorContent(),
          },
          '415': { description: 'Request must use application/json.', content: errorContent() },
          '422': {
            description: 'Request does not match the input schema.',
            content: errorContent(),
          },
          '500': { description: 'Execution or output validation failed.', content: errorContent() },
          '503': {
            description: 'No unique compatible binding is available.',
            content: errorContent(),
          },
          '504': {
            description: 'Execution exceeded its configured deadline.',
            content: errorContent(),
          },
        },
      },
    };
  }
  return Object.freeze({
    openapi: '3.1.0',
    info: {
      title: 'Agent Native Capability API',
      version: '1.0.0',
      description: 'Generated from explicitly public read capability contracts.',
    },
    paths,
  });
}

function jsonResponse(body: unknown, status: number): Response {
  const serialized = JSON.stringify(body);
  if (serialized === undefined)
    throw new TypeError('response body could not be serialized as JSON');
  return new Response(serialized, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

async function readJsonBody(request: Request, limit: number): Promise<unknown> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new TypeError('unsupported-content-type');
  }
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^[0-9]+$/.test(length)) throw new TypeError('invalid-json');
    if (Number(length) > limit) throw new RangeError('too-large');
  }
  if (request.body === null) throw new TypeError('invalid-json');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError('too-large');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TypeError('invalid-json');
  }
}

function deadlineSignal(): { readonly signal: ExecutionSignal; abort(): void } {
  let aborted = false;
  return {
    signal: Object.freeze({
      get aborted() {
        return aborted;
      },
    }),
    abort() {
      aborted = true;
    },
  };
}

function failureResponse(result: Extract<ExecutionResult, { kind: 'failure' }>): Response {
  switch (result.reason) {
    case 'capability-missing':
    case 'invalid-identity':
    case 'unauthorized':
      return errorResponse(404, 'not_found', 'Capability not found.');
    case 'invalid-input':
      return errorResponse(
        422,
        'invalid_input',
        'Request does not match the capability input schema.',
      );
    case 'binding-unavailable':
    case 'binding-ambiguous':
    case 'authorization-error':
      return errorResponse(503, 'unavailable', 'Capability is not currently available.');
    case 'deadline-exceeded':
      return errorResponse(504, 'deadline_exceeded', 'Capability execution exceeded its deadline.');
    case 'invalid-output':
    case 'handler-failed':
      return errorResponse(500, 'execution_failed', 'Capability execution failed.');
  }
}

type TimedResult =
  | { readonly kind: 'complete'; readonly result: ExecutionResult }
  | { readonly kind: 'timeout' };

export function createHttpHandler(
  registry: CapabilityRegistry,
  options: HttpAdapterOptions = {},
): (request: Request) => Promise<Response> {
  const config = validateOptions(options);
  const openApiPath = config.root + '/openapi.json';
  const healthPath = config.root + '/health';
  const routeMap = new Map<string, CapabilityDefinition<unknown, unknown>>();
  for (const definition of registry.definitions.filter(isPublicRead)) {
    routeMap.set(httpInvocationPath(definition.identity, config.root), definition);
  }
  const resolveContext =
    options.resolveExecutionContext ??
    (() => ({
      caller: { kind: 'anonymous' as const },
      authorization: {
        authorize: (request) => request.risk === 'read' && request.access.kind === 'public',
      },
    }));

  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname === healthPath && request.method === 'GET') {
      return jsonResponse(
        {
          observation: createDiagnosticObservation({
            checkId: 'UAN-003.http-protocol',
            status: 'passed',
          }),
        },
        200,
      );
    }
    if (pathname === openApiPath && request.method === 'GET') {
      try {
        return jsonResponse(createOpenApiDocument(registry, { basePath: config.root }), 200);
      } catch {
        return errorResponse(
          500,
          'schema_unavailable',
          'Public API schema could not be generated.',
        );
      }
    }

    const definition = routeMap.get(pathname);
    if (definition === undefined) {
      return jsonResponse({ error: { code: 'not_found', message: 'Capability not found.' } }, 404);
    }
    if (request.method !== 'POST') {
      if (!isPublicRead(definition)) {
        return jsonResponse(
          { error: { code: 'not_found', message: 'Capability not found.' } },
          404,
        );
      }
      return new Response(null, { status: 405, headers: { allow: 'POST' } });
    }

    let input: unknown;
    try {
      input = await readJsonBody(request, config.maxRequestBytes);
    } catch (error) {
      if (error instanceof RangeError && error.message === 'too-large') {
        return errorResponse(
          413,
          'request_too_large',
          'Request body exceeds the configured limit.',
        );
      }
      if (error instanceof TypeError && error.message === 'unsupported-content-type') {
        return errorResponse(415, 'unsupported_media_type', 'Request must use application/json.');
      }
      return errorResponse(400, 'invalid_json', 'Request body must contain valid UTF-8 JSON.');
    }

    const deadline = deadlineSignal();
    let timer: number | undefined;
    const timeout = new Promise<TimedResult>((resolve) => {
      timer = setTimeout(() => {
        deadline.abort();
        resolve({ kind: 'timeout' });
      }, config.deadlineMs);
    });
    const operation = (async (): Promise<TimedResult> => {
      const context = await resolveContext(request);
      if (deadline.signal.aborted) return { kind: 'timeout' };
      const result = await executeCapability(registry, {
        identity: definition.identity,
        runtime: 'server',
        input,
        caller: context.caller,
        authorization: context.authorization,
        signal: deadline.signal,
      });
      return { kind: 'complete', result };
    })();

    try {
      const result = await Promise.race([operation, timeout]);
      if (timer !== undefined) clearTimeout(timer);
      if (result.kind === 'timeout') {
        return errorResponse(
          504,
          'deadline_exceeded',
          'Capability execution exceeded its deadline.',
        );
      }
      if (result.result.kind === 'failure') return failureResponse(result.result);
      try {
        return jsonResponse(result.result.value, 200);
      } catch {
        return errorResponse(500, 'execution_failed', 'Capability execution failed.');
      }
    } catch {
      if (timer !== undefined) clearTimeout(timer);
      deadline.abort();
      return errorResponse(503, 'unavailable', 'Capability is not currently available.');
    }
  };
}
