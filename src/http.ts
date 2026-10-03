import { capabilitySurfaceNames } from './core/composition.js';
import { type CapabilityDefinition, canonicalCapabilityId } from './core/contracts.js';
import { createDiagnosticObservation } from './core/diagnostics.js';
import type { AuthorizationPort, ExecutionCaller, ExecutionResult } from './core/executor.js';
import { executeCapability } from './core/executor.js';
import type { CapabilityRegistry, ExecutionSignal } from './core/registry.js';
import { cloneJsonValue, type JsonValue } from './core/schema.js';

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
  identityOrDefinition:
    | CapabilityDefinition<unknown, unknown>['identity']
    | CapabilityDefinition<unknown, unknown>,
  root = DEFAULT_BASE_PATH,
): string {
  if ('identity' in identityOrDefinition) {
    return (
      identityOrDefinition.surfaces?.http?.path ??
      basePath(root) + capabilitySurfaceNames(identityOrDefinition.identity).http
    );
  }
  return basePath(root) + capabilitySurfaceNames(identityOrDefinition).http;
}

function httpMethod(definition: CapabilityDefinition<unknown, unknown>): 'GET' | 'POST' {
  return definition.surfaces?.http?.method ?? 'POST';
}

function isPublicRead(definition: CapabilityDefinition<unknown, unknown>): boolean {
  return definition.risk === 'read' && definition.access.kind === 'public';
}

function hasUniqueServerBinding(
  registry: CapabilityRegistry,
  definition: CapabilityDefinition<unknown, unknown>,
): boolean {
  const id = canonicalCapabilityId(definition.identity);
  return (
    registry.bindings.filter(
      (binding) => binding.capabilityId === id && binding.targets.includes('server'),
    ).length === 1
  );
}

function copySchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: unknown = cloneJsonValue(schema, 'schema');
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new TypeError('schema must serialize to an object');
  }
  return result as Record<string, unknown>;
}

type QueryField = {
  readonly field: string;
  readonly parameter: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly array: boolean;
};

function scalarQuerySchema(
  value: unknown,
  field: string,
): { readonly schema: Readonly<Record<string, unknown>>; readonly array: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`GET input field ${field} has an unsupported query conversion`);
  }
  const schema = value as Readonly<Record<string, unknown>>;
  if (Array.isArray(schema['enum']) && schema['enum'].every((item) => typeof item === 'string')) {
    return { schema, array: false };
  }
  if (schema['type'] === 'array') {
    const item = scalarQuerySchema(schema['items'], field);
    if (item.array) throw new TypeError(`GET input field ${field} has nested arrays`);
    return { schema, array: true };
  }
  if (!['string', 'number', 'integer', 'boolean'].includes(String(schema['type']))) {
    throw new TypeError(`GET input field ${field} has an unsupported query conversion`);
  }
  return { schema, array: false };
}

function queryFields(definition: CapabilityDefinition<unknown, unknown>): readonly QueryField[] {
  const schema = definition.input.toJSONSchema();
  const properties = schema['properties'];
  if (
    schema['type'] !== 'object' ||
    typeof properties !== 'object' ||
    properties === null ||
    Array.isArray(properties)
  ) {
    throw new TypeError('GET HTTP surfaces require a top-level object input schema');
  }
  const mapping = definition.surfaces?.http?.query ?? {};
  for (const field of Object.keys(mapping)) {
    if (!Object.hasOwn(properties, field)) {
      throw new TypeError(`GET query mapping references unknown input field ${field}`);
    }
  }
  const parameters = new Set<string>();
  return Object.entries(properties).map(([field, value]) => {
    const parameter = Object.hasOwn(mapping, field) ? mapping[field] : field;
    if (parameter === undefined) throw new TypeError(`missing GET query parameter ${field}`);
    if (parameters.has(parameter))
      throw new TypeError(`duplicate GET query parameter ${parameter}`);
    parameters.add(parameter);
    return { field, parameter, ...scalarQuerySchema(value, field) };
  });
}

function parseQueryScalar(value: string, schema: Readonly<Record<string, unknown>>): unknown {
  if (Array.isArray(schema['enum'])) {
    const match = schema['enum'].find((candidate) => candidate === value);
    if (match === undefined) throw new TypeError('invalid query enum');
    return match;
  }
  switch (schema['type']) {
    case 'string':
      return value;
    case 'number': {
      if (value.trim().length === 0) throw new TypeError('invalid query number');
      const number = Number(value);
      if (!Number.isFinite(number)) throw new TypeError('invalid query number');
      return number;
    }
    case 'integer': {
      if (value.trim().length === 0) throw new TypeError('invalid query integer');
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new TypeError('invalid query integer');
      return number;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') throw new TypeError('invalid query boolean');
      return value === 'true';
    default:
      throw new TypeError('unsupported query conversion');
  }
}

function queryInput(url: URL, fields: readonly QueryField[]): unknown {
  const known = new Set(fields.map((field) => field.parameter));
  for (const parameter of url.searchParams.keys()) {
    if (!known.has(parameter)) throw new TypeError(`unknown query parameter ${parameter}`);
  }
  const input: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const values = url.searchParams.getAll(field.parameter);
    if (values.length === 0) continue;
    if (!field.array && values.length !== 1) {
      throw new TypeError(`duplicate query parameter ${field.parameter}`);
    }
    if (field.array) {
      const items = field.schema['items'] as Readonly<Record<string, unknown>>;
      input[field.field] = values.map((value) => parseQueryScalar(value, items));
    } else {
      input[field.field] = parseQueryScalar(values[0] ?? '', field.schema);
    }
  }
  return input;
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function httpQueryParameters(
  definition: CapabilityDefinition<unknown, unknown>,
  input: unknown,
): URLSearchParams {
  if (httpMethod(definition) !== 'GET') {
    throw new TypeError('HTTP query parameters require a GET surface');
  }
  const value = cloneJsonValue(input, 'GET request input');
  if (!isJsonObject(value)) {
    throw new TypeError('GET request input must be an object');
  }
  const parameters = new URLSearchParams();
  for (const field of queryFields(definition)) {
    const item = value[field.field];
    if (item === undefined) continue;
    const values = field.array ? item : [item];
    if (!Array.isArray(values)) {
      throw new TypeError(`GET input field ${field.field} must be an array`);
    }
    for (const entry of values) {
      if (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
        throw new TypeError(`GET input field ${field.field} cannot be represented in a query`);
      }
      parameters.append(field.parameter, String(entry));
    }
  }
  return parameters;
}

function visibleDefinitions(registry: CapabilityRegistry, root = DEFAULT_BASE_PATH) {
  const definitions = registry.definitions.filter(
    (candidate) => isPublicRead(candidate) && hasUniqueServerBinding(registry, candidate),
  );
  const paths = new Map<string, string>();
  const reservedPaths = new Set([`${root}/openapi.json`, `${root}/health`]);
  for (const definition of definitions) {
    const path = httpInvocationPath(definition, root);
    if (reservedPaths.has(path)) throw new TypeError(`reserved HTTP path ${path}`);
    const previous = paths.get(path);
    if (previous !== undefined) {
      throw new TypeError(
        `duplicate HTTP path ${path} for ${previous} and ${canonicalCapabilityId(definition.identity)}`,
      );
    }
    paths.set(path, canonicalCapabilityId(definition.identity));
    if (httpMethod(definition) === 'GET') queryFields(definition);
  }
  return definitions;
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
  for (const definition of visibleDefinitions(registry, root)) {
    const id = canonicalCapabilityId(definition.identity);
    const operationId = capabilitySurfaceNames(definition.identity).openApiOperation;
    const method = httpMethod(definition);
    const inputSchema = copySchema(definition.input.toJSONSchema());
    const input =
      method === 'GET'
        ? {
            parameters: queryFields(definition).map((field) => ({
              name: field.parameter,
              in: 'query',
              required:
                Array.isArray(inputSchema['required']) &&
                inputSchema['required'].includes(field.field),
              schema: copySchema(field.schema),
              ...(field.array ? { style: 'form', explode: true } : {}),
            })),
          }
        : {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: inputSchema } },
            },
          };
    paths[httpInvocationPath(definition, root)] = {
      [method.toLowerCase()]: {
        operationId,
        summary: definition.description,
        description:
          method === 'GET'
            ? 'Read-only capability invocation through query parameters.'
            : 'Generic capability invocation, not a REST resource route.',
        'x-agent-native-capability-id': id,
        ...input,
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
  const serialized = JSON.stringify(cloneJsonValue(body, 'response body'));
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
  const openApiPath = `${config.root}/openapi.json`;
  const healthPath = `${config.root}/health`;
  const routeMap = new Map<
    string,
    {
      readonly definition: CapabilityDefinition<unknown, unknown>;
      readonly query?: readonly QueryField[];
    }
  >();
  for (const definition of visibleDefinitions(registry, config.root)) {
    const path = httpInvocationPath(definition, config.root);
    if (path === openApiPath || path === healthPath || routeMap.has(path)) {
      throw new TypeError(`duplicate or reserved HTTP path ${path}`);
    }
    routeMap.set(path, {
      definition,
      ...(httpMethod(definition) === 'GET' ? { query: queryFields(definition) } : {}),
    });
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
    const url = new URL(request.url);
    const pathname = url.pathname;
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

    const route = routeMap.get(pathname);
    if (route === undefined) {
      return jsonResponse({ error: { code: 'not_found', message: 'Capability not found.' } }, 404);
    }
    const definition = route.definition;
    const method = httpMethod(definition);
    if (request.method !== method) {
      return new Response(null, { status: 405, headers: { allow: method } });
    }

    let input: unknown;
    if (method === 'GET') {
      if (new TextEncoder().encode(url.search).byteLength > config.maxRequestBytes) {
        return errorResponse(
          413,
          'request_too_large',
          'Request query exceeds the configured limit.',
        );
      }
      try {
        input = queryInput(url, route.query ?? []);
      } catch {
        return errorResponse(
          422,
          'invalid_input',
          'Request does not match the capability input schema.',
        );
      }
    } else {
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
    }

    const deadline = deadlineSignal();
    let timer: ReturnType<typeof setTimeout> | undefined;
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
