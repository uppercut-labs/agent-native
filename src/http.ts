import { capabilitySurfaceNames } from './core/composition.js';
import { type CapabilityDefinition, canonicalCapabilityId } from './core/contracts.js';
import { createDiagnosticObservation } from './core/diagnostics.js';
import { assertNever } from './core/assert-never.js';
import type {
  AuthorizationPort,
  AuthorizationRequest,
  ExecutionCaller,
  ExecutionResult,
} from './core/executor.js';
import { executeCapability } from './core/executor.js';
import type { CapabilityBinding, CapabilityRegistry, ExecutionSignal } from './core/registry.js';
import { cloneJsonValue, type JsonValue } from './core/schema.js';

const DEFAULT_BASE_PATH: '/agent-native/v1' = '/agent-native/v1';
const DEFAULT_MAX_BYTES: number = 32 * 1024;
const DEFAULT_DEADLINE_MS: number = 10_000;
const MAX_BODY_BYTES: number = 1024 * 1024;
const MAX_DEADLINE_MS: number = 300_000;
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

function basePath(value: string = DEFAULT_BASE_PATH): string {
  if (
    !value.startsWith('/') ||
    value === '/' ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    value.split('/').some((part: string): boolean => part === '.' || part === '..')
  ) {
    throw new TypeError(
      'basePath must be an absolute URL path without query or traversal segments',
    );
  }
  let result: string = value;
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  if (
    result.includes('//') ||
    !result
      .slice(1)
      .split('/')
      .every((segment: string): boolean =>
        Array.from(segment).every((character: string): boolean =>
          /[A-Za-z0-9._~-]/.test(character),
        ),
      )
  ) {
    throw new TypeError('basePath contains unsupported path characters');
  }
  return result;
}

type ValidatedHttpOptions = {
  readonly root: string;
  readonly maxRequestBytes: number;
  readonly deadlineMs: number;
};

function validateOptions(options: HttpAdapterOptions): ValidatedHttpOptions {
  const root: string = basePath(options.basePath);
  const maxRequestBytes: number = options.maxRequestBytes ?? DEFAULT_MAX_BYTES;
  const deadlineMs: number = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
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
  root: string = DEFAULT_BASE_PATH,
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
  const id: string = canonicalCapabilityId(definition.identity);
  return (
    registry.bindings.filter(
      (binding: CapabilityBinding): boolean =>
        binding.capabilityId === id && binding.targets.includes('server'),
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
  const schema: Readonly<Record<string, unknown>> = value as Readonly<Record<string, unknown>>;
  if (
    Array.isArray(schema['enum']) &&
    schema['enum'].every((item: unknown): boolean => typeof item === 'string')
  ) {
    return { schema, array: false };
  }
  if (schema['type'] === 'array') {
    const item: { readonly schema: Readonly<Record<string, unknown>>; readonly array: boolean } =
      scalarQuerySchema(schema['items'], field);
    if (item.array) throw new TypeError(`GET input field ${field} has nested arrays`);
    return { schema, array: true };
  }
  if (!['string', 'number', 'integer', 'boolean'].includes(String(schema['type']))) {
    throw new TypeError(`GET input field ${field} has an unsupported query conversion`);
  }
  return { schema, array: false };
}

function queryFields(definition: CapabilityDefinition<unknown, unknown>): readonly QueryField[] {
  const schema: Readonly<Record<string, unknown>> = definition.input.toJSONSchema();
  const properties: unknown = schema['properties'];
  if (
    schema['type'] !== 'object' ||
    typeof properties !== 'object' ||
    properties === null ||
    Array.isArray(properties)
  ) {
    throw new TypeError('GET HTTP surfaces require a top-level object input schema');
  }
  const mapping: Readonly<Record<string, string>> = definition.surfaces?.http?.query ?? {};
  for (const field of Object.keys(mapping)) {
    if (!Object.hasOwn(properties, field)) {
      throw new TypeError(`GET query mapping references unknown input field ${field}`);
    }
  }
  let parameters: Set<string> = new Set();
  return Object.entries(properties).map(([field, value]: [string, unknown]): QueryField => {
    const parameter: string | undefined = Object.hasOwn(mapping, field) ? mapping[field] : field;
    if (parameter === undefined) throw new TypeError(`missing GET query parameter ${field}`);
    if (parameters.has(parameter))
      throw new TypeError(`duplicate GET query parameter ${parameter}`);
    parameters.add(parameter);
    return { field, parameter, ...scalarQuerySchema(value, field) };
  });
}

function parseQueryScalar(value: string, schema: Readonly<Record<string, unknown>>): unknown {
  if (Array.isArray(schema['enum'])) {
    const match: unknown = schema['enum'].find(
      (candidate: unknown): boolean => candidate === value,
    );
    if (match === undefined) throw new TypeError('invalid query enum');
    return match;
  }
  switch (schema['type']) {
    case 'string':
      return value;
    case 'number': {
      if (value.trim().length === 0) throw new TypeError('invalid query number');
      const number: number = Number(value);
      if (!Number.isFinite(number)) throw new TypeError('invalid query number');
      return number;
    }
    case 'integer': {
      if (value.trim().length === 0) throw new TypeError('invalid query integer');
      const number: number = Number(value);
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
  const known: ReadonlySet<string> = new Set(
    fields.map((field: QueryField): string => field.parameter),
  );
  for (const parameter of url.searchParams.keys()) {
    if (!known.has(parameter)) throw new TypeError(`unknown query parameter ${parameter}`);
  }
  let input: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const values: readonly string[] = url.searchParams.getAll(field.parameter);
    if (values.length === 0) continue;
    if (!field.array && values.length !== 1) {
      throw new TypeError(`duplicate query parameter ${field.parameter}`);
    }
    if (field.array) {
      const items: Readonly<Record<string, unknown>> = field.schema['items'] as Readonly<
        Record<string, unknown>
      >;
      input[field.field] = values.map((value: string): unknown => parseQueryScalar(value, items));
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
  const value: JsonValue = cloneJsonValue(input, 'GET request input');
  if (!isJsonObject(value)) {
    throw new TypeError('GET request input must be an object');
  }
  let parameters: URLSearchParams = new URLSearchParams();
  for (const field of queryFields(definition)) {
    const item: JsonValue | undefined = value[field.field];
    if (item === undefined) continue;
    const values: JsonValue = field.array ? item : [item];
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

function visibleDefinitions(
  registry: CapabilityRegistry,
  root: string = DEFAULT_BASE_PATH,
): readonly CapabilityDefinition<unknown, unknown>[] {
  const definitions: readonly CapabilityDefinition<unknown, unknown>[] =
    registry.definitions.filter(
      (candidate: CapabilityDefinition<unknown, unknown>): boolean =>
        isPublicRead(candidate) && hasUniqueServerBinding(registry, candidate),
    );
  let paths: Map<string, string> = new Map();
  const reservedPaths: ReadonlySet<string> = new Set([`${root}/openapi.json`, `${root}/health`]);
  for (const definition of definitions) {
    const path: string = httpInvocationPath(definition, root);
    if (reservedPaths.has(path)) throw new TypeError(`reserved HTTP path ${path}`);
    const previous: string | undefined = paths.get(path);
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

type OpenApiErrorContent = {
  readonly 'application/json': { readonly schema: Record<string, unknown> };
};

type OpenApiOperationInput =
  | { parameters: OpenApiQueryParameter[]; requestBody?: never }
  | {
      requestBody: {
        required: boolean;
        content: { 'application/json': { schema: Readonly<Record<string, unknown>> } };
      };
      parameters?: never;
    };

type OpenApiQueryParameter = {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly schema: Record<string, unknown>;
  readonly style?: string;
  readonly explode?: boolean;
};

function errorContent(): OpenApiErrorContent {
  return { 'application/json': { schema: copySchema(ERROR_SCHEMA) } };
}

export function createOpenApiDocument(
  registry: CapabilityRegistry,
  options: { readonly basePath?: string } = {},
): Readonly<Record<string, unknown>> {
  const root: string = basePath(options.basePath);
  let paths: Record<string, unknown> = {};
  for (const definition of visibleDefinitions(registry, root)) {
    const id: string = canonicalCapabilityId(definition.identity);
    const operationId: string = capabilitySurfaceNames(definition.identity).openApiOperation;
    const method: 'GET' | 'POST' = httpMethod(definition);
    const inputSchema: Readonly<Record<string, unknown>> = copySchema(
      definition.input.toJSONSchema(),
    );
    const input: OpenApiOperationInput =
      method === 'GET'
        ? {
            parameters: queryFields(definition).map(
              (field: QueryField): OpenApiQueryParameter => ({
                name: field.parameter,
                in: 'query',
                required:
                  Array.isArray(inputSchema['required']) &&
                  inputSchema['required'].includes(field.field),
                schema: copySchema(field.schema),
                ...(field.array ? { style: 'form', explode: true } : {}),
              }),
            ),
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
  const serialized: string = JSON.stringify(cloneJsonValue(body, 'response body'));
  return new Response(serialized, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

async function readJsonBody(request: Request, limit: number): Promise<unknown> {
  const mediaType: string | undefined = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new TypeError('unsupported-content-type');
  }
  const length: string | null = request.headers.get('content-length');
  if (length !== null) {
    if (!/^[0-9]+$/.test(length)) throw new TypeError('invalid-json');
    if (Number(length) > limit) throw new RangeError('too-large');
  }
  if (request.body === null) throw new TypeError('invalid-json');

  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> = request.body.getReader();
  let chunks: Uint8Array[] = [];
  let size: number = 0;
  try {
    while (true) {
      const part: ReadableStreamReadResult<Uint8Array<ArrayBuffer>> = await reader.read();
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
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(size);
  let offset: number = 0;
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
  let aborted: boolean = false;
  return {
    signal: Object.freeze({
      get aborted(): boolean {
        return aborted;
      },
    }),
    abort(): void {
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
    default:
      return assertNever(result.reason);
  }
}

type HttpRoute = {
  readonly definition: CapabilityDefinition<unknown, unknown>;
  readonly query?: readonly QueryField[];
};

type TimedResult =
  | { readonly kind: 'complete'; readonly result: ExecutionResult }
  | { readonly kind: 'timeout' };

export function createHttpHandler(
  registry: CapabilityRegistry,
  options: HttpAdapterOptions = {},
): (request: Request) => Promise<Response> {
  const config: ValidatedHttpOptions = validateOptions(options);
  const openApiPath: string = `${config.root}/openapi.json`;
  const healthPath: string = `${config.root}/health`;
  let routeMap: Map<string, HttpRoute> = new Map();
  for (const definition of visibleDefinitions(registry, config.root)) {
    const path: string = httpInvocationPath(definition, config.root);
    if (path === openApiPath || path === healthPath || routeMap.has(path)) {
      throw new TypeError(`duplicate or reserved HTTP path ${path}`);
    }
    routeMap.set(path, {
      definition,
      ...(httpMethod(definition) === 'GET' ? { query: queryFields(definition) } : {}),
    });
  }
  const resolveContext: (request: Request) => HttpExecutionContext | Promise<HttpExecutionContext> =
    options.resolveExecutionContext ??
    ((): HttpExecutionContext => ({
      caller: { kind: 'anonymous' as const },
      authorization: {
        authorize: (request: AuthorizationRequest): boolean =>
          request.risk === 'read' && request.access.kind === 'public',
      },
    }));

  return async (request: Request): Promise<Response> => {
    const url: URL = new URL(request.url);
    const pathname: string = url.pathname;
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

    const route: HttpRoute | undefined = routeMap.get(pathname);
    if (route === undefined) {
      return jsonResponse({ error: { code: 'not_found', message: 'Capability not found.' } }, 404);
    }
    const definition: CapabilityDefinition<unknown, unknown> = route.definition;
    const method: 'GET' | 'POST' = httpMethod(definition);
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
      } catch (error: unknown) {
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

    let deadline: { readonly signal: ExecutionSignal; abort(): void } = deadlineSignal();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout: Promise<TimedResult> = new Promise<TimedResult>(
      (resolve: (value: TimedResult) => void): void => {
        timer = setTimeout((): void => {
          deadline.abort();
          resolve({ kind: 'timeout' });
        }, config.deadlineMs);
      },
    );
    const operation: Promise<TimedResult> = (async (): Promise<TimedResult> => {
      const context: HttpExecutionContext = await resolveContext(request);
      if (deadline.signal.aborted) return { kind: 'timeout' };
      const result: ExecutionResult = await executeCapability(registry, {
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
      const result: TimedResult = await Promise.race([operation, timeout]);
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
