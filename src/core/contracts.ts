import { cloneJsonValue, type SchemaPort } from './schema.js';
import { createDiagnosticObservation, type DiagnosticObservation } from './diagnostics.js';

export type CapabilityIdentity = {
  readonly namespace: string;
  readonly name: string;
  readonly majorVersion: number;
};

export type CapabilityRisk = 'read' | 'write' | 'destructive';

export type CapabilityAccessRule =
  | { readonly kind: 'public' }
  | { readonly kind: 'protected'; readonly scopes: readonly string[] };

export type CapabilityHttpSurface = {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  /** Maps input property names to HTTP query parameter names for GET routes. */
  readonly query?: Readonly<Record<string, string>>;
};

export type CapabilityCliSurface = {
  readonly command: string;
  readonly aliases?: readonly string[];
};

export type CapabilitySurfaceOverrides = {
  readonly http?: CapabilityHttpSurface;
  readonly cli?: CapabilityCliSurface;
};

export type CapabilityDefinition<Input, Output> = {
  readonly identity: CapabilityIdentity;
  readonly description: string;
  readonly input: SchemaPort<Input>;
  readonly output: SchemaPort<Output>;
  readonly risk: CapabilityRisk;
  readonly access: CapabilityAccessRule;
  readonly surfaces?: CapabilitySurfaceOverrides;
};

export type CapabilityDefinitionOptions<Input, Output> = {
  readonly identity: CapabilityIdentity;
  readonly description: string;
  readonly input: SchemaPort<Input>;
  readonly output: SchemaPort<Output>;
  readonly risk: CapabilityRisk;
  readonly access: CapabilityAccessRule;
  readonly surfaces?: CapabilitySurfaceOverrides;
};

export class CapabilityDefinitionError extends TypeError {
  public readonly observation: DiagnosticObservation;

  public constructor(message: string) {
    super(message);
    this.name = 'CapabilityDefinitionError';
    this.observation = createDiagnosticObservation({
      checkId: 'UAN-002.invalid-schema',
      status: 'failed',
    });
  }
}

const IDENTITY_SLUG_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const CLI_COMMAND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QUERY_PARAMETER_PATTERN = /^[A-Za-z0-9._~-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateHttpPath(path: unknown): asserts path is string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path === '/' ||
    path.endsWith('/') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('\\') ||
    path.includes('//') ||
    path.split('/').some((part) => part === '.' || part === '..') ||
    !path
      .slice(1)
      .split('/')
      .every((segment) =>
        Array.from(segment).every((character) => /[A-Za-z0-9._~-]/.test(character)),
      )
  ) {
    throw new TypeError(
      'surfaces.http.path must be an absolute URL path without a query, fragment, or traversal',
    );
  }
}

function validateSurfaces(surfaces: CapabilitySurfaceOverrides | undefined, risk: CapabilityRisk) {
  if (surfaces === undefined) return;
  if (!isRecord(surfaces)) throw new TypeError('surfaces must be an object');
  if (Object.keys(surfaces).some((key) => key !== 'http' && key !== 'cli')) {
    throw new TypeError('surfaces contains an unsupported adapter override');
  }
  if (surfaces.http !== undefined) {
    if (!isRecord(surfaces.http)) throw new TypeError('surfaces.http must be an object');
    if (
      Object.keys(surfaces.http).some(
        (key) => key !== 'path' && key !== 'method' && key !== 'query',
      )
    ) {
      throw new TypeError('surfaces.http contains an unsupported option');
    }
    validateHttpPath(surfaces.http.path);
    if (surfaces.http.method !== 'GET' && surfaces.http.method !== 'POST') {
      throw new TypeError('surfaces.http.method must be GET or POST');
    }
    if (surfaces.http.method === 'GET' && risk !== 'read') {
      throw new TypeError('GET HTTP surfaces are only valid for read capabilities');
    }
    if (surfaces.http.method === 'POST' && surfaces.http.query !== undefined) {
      throw new TypeError('surfaces.http.query is only valid for GET surfaces');
    }
    if (surfaces.http.query !== undefined) {
      if (!isRecord(surfaces.http.query)) {
        throw new TypeError('surfaces.http.query must map input fields to query parameters');
      }
      const parameters = new Set<string>();
      for (const [field, parameter] of Object.entries(surfaces.http.query)) {
        if (
          field.length === 0 ||
          typeof parameter !== 'string' ||
          !QUERY_PARAMETER_PATTERN.test(parameter)
        ) {
          throw new TypeError('surfaces.http.query must map fields to valid query parameter names');
        }
        if (parameters.has(parameter)) {
          throw new TypeError(`surfaces.http.query contains duplicate parameter ${parameter}`);
        }
        parameters.add(parameter);
      }
    }
  }
  if (surfaces.cli !== undefined) {
    if (!isRecord(surfaces.cli)) throw new TypeError('surfaces.cli must be an object');
    if (Object.keys(surfaces.cli).some((key) => key !== 'command' && key !== 'aliases')) {
      throw new TypeError('surfaces.cli contains an unsupported option');
    }
    if (!CLI_COMMAND_PATTERN.test(surfaces.cli.command)) {
      throw new TypeError('surfaces.cli.command must be a lowercase command slug');
    }
    if (
      surfaces.cli.aliases !== undefined &&
      (!Array.isArray(surfaces.cli.aliases) ||
        surfaces.cli.aliases.some(
          (alias) => typeof alias !== 'string' || !CLI_COMMAND_PATTERN.test(alias),
        ))
    ) {
      throw new TypeError('surfaces.cli.aliases must contain lowercase command slugs');
    }
    const names = [surfaces.cli.command, ...(surfaces.cli.aliases ?? [])];
    if (new Set(names).size !== names.length) {
      throw new TypeError('surfaces.cli command and aliases must be unique');
    }
  }
}

function freezeSurfaces(
  surfaces: CapabilitySurfaceOverrides | undefined,
): CapabilitySurfaceOverrides | undefined {
  if (surfaces === undefined) return undefined;
  const http =
    surfaces.http === undefined
      ? undefined
      : Object.freeze({
          path: surfaces.http.path,
          method: surfaces.http.method,
          ...(surfaces.http.query === undefined
            ? {}
            : { query: Object.freeze({ ...surfaces.http.query }) }),
        });
  const cli =
    surfaces.cli === undefined
      ? undefined
      : Object.freeze({
          command: surfaces.cli.command,
          ...(surfaces.cli.aliases === undefined
            ? {}
            : { aliases: Object.freeze([...surfaces.cli.aliases]) }),
        });
  return Object.freeze({
    ...(http === undefined ? {} : { http }),
    ...(cli === undefined ? {} : { cli }),
  });
}

export function isCapabilityDefinition(
  value: unknown,
): value is CapabilityDefinition<unknown, unknown> {
  if (!isRecord(value) || !isRecord(value['identity']) || !isRecord(value['access'])) {
    return false;
  }
  const identity = value['identity'];
  if (
    typeof identity['namespace'] !== 'string' ||
    typeof identity['name'] !== 'string' ||
    typeof identity['majorVersion'] !== 'number' ||
    !isValidCapabilityIdentity({
      namespace: identity['namespace'],
      name: identity['name'],
      majorVersion: identity['majorVersion'],
    }) ||
    typeof value['description'] !== 'string' ||
    value['description'].trim().length === 0 ||
    (value['risk'] !== 'read' && value['risk'] !== 'write' && value['risk'] !== 'destructive')
  ) {
    return false;
  }
  try {
    validateSurfaces(value['surfaces'] as CapabilitySurfaceOverrides | undefined, value['risk']);
  } catch {
    return false;
  }
  const access = value['access'];
  if (access['kind'] === 'public') {
    if (value['risk'] !== 'read' || Object.keys(access).length !== 1) {
      return false;
    }
  } else if (
    access['kind'] !== 'protected' ||
    !Array.isArray(access['scopes']) ||
    access['scopes'].length === 0 ||
    access['scopes'].some(
      (scope: unknown) => typeof scope !== 'string' || !/^[a-z][a-z0-9:._-]{0,63}$/.test(scope),
    )
  ) {
    return false;
  }
  if (
    !isRecord(value['input']) ||
    typeof value['input']['parse'] !== 'function' ||
    typeof value['input']['toJSONSchema'] !== 'function' ||
    !isRecord(value['output']) ||
    typeof value['output']['parse'] !== 'function' ||
    typeof value['output']['toJSONSchema'] !== 'function'
  ) {
    return false;
  }
  try {
    const inputSchema: unknown = value['input']['toJSONSchema']();
    const outputSchema: unknown = value['output']['toJSONSchema']();
    return (
      isRecord(inputSchema) &&
      isRecord(outputSchema) &&
      isRecord(cloneJsonValue(inputSchema, 'input schema')) &&
      isRecord(cloneJsonValue(outputSchema, 'output schema'))
    );
  } catch {
    return false;
  }
}

export function isValidCapabilityIdentity(identity: CapabilityIdentity): boolean {
  return (
    IDENTITY_SLUG_PATTERN.test(identity.namespace) &&
    IDENTITY_SLUG_PATTERN.test(identity.name) &&
    identity.namespace.length <= 64 &&
    identity.name.length <= 64 &&
    Number.isSafeInteger(identity.majorVersion) &&
    identity.majorVersion >= 1
  );
}

export function canonicalCapabilityId(identity: CapabilityIdentity): string {
  if (!isValidCapabilityIdentity(identity)) {
    throw new TypeError(
      'identity must use lowercase capability slugs and a positive major version',
    );
  }
  return `${identity.namespace}:${identity.name}@${identity.majorVersion}`;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export function defineCapability<Input, Output>(
  options: CapabilityDefinitionOptions<Input, Output>,
): CapabilityDefinition<Input, Output> {
  if (
    !IDENTITY_SLUG_PATTERN.test(options.identity.namespace) ||
    !IDENTITY_SLUG_PATTERN.test(options.identity.name) ||
    options.identity.namespace.length > 64 ||
    options.identity.name.length > 64
  ) {
    throw new TypeError(
      'identity must use lowercase capability slugs and a positive major version',
    );
  }
  if (!Number.isSafeInteger(options.identity.majorVersion) || options.identity.majorVersion < 1) {
    throw new RangeError('identity.majorVersion must be a positive safe integer');
  }
  assertNonEmpty(options.description, 'description');

  if (options.risk !== 'read' && options.risk !== 'write' && options.risk !== 'destructive') {
    throw new TypeError('risk must be read, write, or destructive');
  }
  if (typeof options.access !== 'object' || options.access === null) {
    throw new TypeError('access metadata must be explicit');
  }
  if (options.access.kind === 'public' && options.risk !== 'read') {
    throw new TypeError('public access is only valid for read capabilities');
  }
  if (options.access.kind === 'protected') {
    if (
      options.access.scopes.length === 0 ||
      options.access.scopes.some((scope) => !/^[a-z][a-z0-9:._-]{0,63}$/.test(scope))
    ) {
      throw new TypeError('protected access requires one or more valid scopes');
    }
  } else if (options.access.kind !== 'public') {
    throw new TypeError('access.kind must be public or protected');
  }

  validateSurfaces(options.surfaces, options.risk);

  if (
    typeof options.input?.parse !== 'function' ||
    typeof options.input.toJSONSchema !== 'function' ||
    typeof options.output?.parse !== 'function' ||
    typeof options.output.toJSONSchema !== 'function'
  ) {
    throw new CapabilityDefinitionError('input and output must be valid schema ports');
  }
  for (const [label, schema] of [
    ['input', options.input],
    ['output', options.output],
  ] as const) {
    let jsonSchema: unknown;
    try {
      jsonSchema = schema.toJSONSchema();
    } catch {
      throw new CapabilityDefinitionError(`${label} schema cannot be represented as JSON Schema`);
    }
    if (typeof jsonSchema !== 'object' || jsonSchema === null || Array.isArray(jsonSchema)) {
      throw new CapabilityDefinitionError(`${label} schema must export a JSON Schema object`);
    }
    try {
      cloneJsonValue(jsonSchema, `${label} schema`);
    } catch {
      throw new CapabilityDefinitionError(`${label} schema must contain only JSON values`);
    }
  }

  const identity: CapabilityIdentity = Object.freeze({ ...options.identity });
  const access: CapabilityAccessRule =
    options.access.kind === 'public'
      ? Object.freeze({ kind: 'public' })
      : Object.freeze({ kind: 'protected', scopes: Object.freeze([...options.access.scopes]) });
  const surfaces = freezeSurfaces(options.surfaces);
  return Object.freeze({
    identity,
    description: options.description.trim(),
    input: options.input,
    output: options.output,
    risk: options.risk,
    access,
    ...(surfaces === undefined ? {} : { surfaces }),
  });
}
