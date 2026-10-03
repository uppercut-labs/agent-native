import { canonicalCapabilityId, type CapabilityDefinition } from './core/contracts.js';
import type { AuthorizationPort, ExecutionCaller, ExecutionResult } from './core/executor.js';
import { executeCapability } from './core/executor.js';
import type { CapabilityRegistry } from './core/registry.js';
import { httpInvocationPath } from './http.js';
import {
  evaluateCapabilityDiscovery,
  isDestructiveCapabilityExposed,
  type CapabilitySurfaceExposure,
} from './discovery.js';

export const CLI_RESULT_SCHEMA_VERSION = 'uan.cli-result/v1';

export const CLI_RESULT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    schemaVersion: { const: CLI_RESULT_SCHEMA_VERSION },
    target: {
      type: 'object',
      properties: {
        mode: { enum: ['local', 'remote'] },
        capabilityId: { type: 'string' },
        profile: { type: 'string' },
      },
      additionalProperties: false,
    },
    result: {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'success' },
            capabilityId: { type: 'string' },
            value: {},
          },
          required: ['kind', 'capabilityId', 'value'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'failure' },
            reason: { type: 'string' },
          },
          required: ['kind', 'reason'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['schemaVersion', 'target', 'result'],
  additionalProperties: false,
} as const;

export type CliCredentialProfile = {
  readonly baseUrl: string;
  readonly token: string;
};

export interface CliStreams {
  writeStdout(value: string): void;
  writeStderr(value: string): void;
  readStdin?(): Promise<string>;
}

export type CapabilityCliOptions = {
  readonly registry: CapabilityRegistry;
  readonly authorization: AuthorizationPort;
  readonly caller: ExecutionCaller;
  readonly credentialProfiles?: Readonly<Record<string, CliCredentialProfile>>;
  readonly packageVersion?: string;
  readonly fetcher?: typeof fetch;
  readonly surfaceExposure?: CapabilitySurfaceExposure;
  readonly canDiscover?: (
    definition: CapabilityDefinition<unknown, unknown>,
  ) => boolean | Promise<boolean>;
};

type ParsedArguments = {
  readonly identity: string | undefined;
  readonly mode: 'local' | 'remote' | undefined;
  readonly profile: string | undefined;
  readonly bindingId: string | undefined;
  readonly timeoutMs: number;
  readonly help: boolean;
  readonly version: boolean;
  readonly inputJson: string | undefined;
  readonly flags: ReadonlyMap<string, string>;
};

type CliFailure = {
  readonly kind: 'failure';
  readonly reason: string;
  readonly capabilityId?: string;
};

type CliSuccess = {
  readonly kind: 'success';
  readonly capabilityId: string;
  readonly value: unknown;
};

type CliResult = CliFailure | CliSuccess;

function parseArguments(argv: readonly string[]): ParsedArguments {
  let identity: string | undefined;
  let mode: 'local' | 'remote' | undefined;
  let profile: string | undefined;
  let bindingId: string | undefined;
  let timeoutMs = 10_000;
  let help = false;
  let version = false;
  let inputJson: string | undefined;
  const flags: Map<string, string> = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--version') {
      version = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      if (identity !== undefined) throw new TypeError('only one capability identity is allowed');
      identity = argument;
      continue;
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`flag --${key} requires a value`);
    }
    index += 1;
    switch (key) {
      case 'mode':
        if (value !== 'local' && value !== 'remote') {
          throw new TypeError('--mode must be local or remote');
        }
        mode = value;
        break;
      case 'profile':
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(value)) {
          throw new TypeError('--profile must be a lowercase profile slug');
        }
        profile = value;
        break;
      case 'binding-id':
        bindingId = value;
        break;
      case 'timeout-ms': {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 300_000) {
          throw new TypeError('--timeout-ms must be an integer from 1 to 300000');
        }
        timeoutMs = parsed;
        break;
      }
      case 'input-json':
        inputJson = value;
        break;
      default:
        if (!/^[a-z][a-z0-9-]*$/.test(key)) {
          throw new TypeError(`invalid flag name: --${key}`);
        }
        if (flags.has(key)) throw new TypeError(`duplicate flag: --${key}`);
        flags.set(key, value);
    }
  }

  if (inputJson !== undefined && flags.size > 0) {
    throw new TypeError('--input-json cannot be combined with field flags');
  }
  if (mode === 'local' && profile !== undefined) {
    throw new TypeError('--profile is only valid with --mode remote');
  }
  if (mode === 'remote' && bindingId !== undefined) {
    throw new TypeError('--binding-id is only valid with --mode local');
  }
  return { identity, mode, profile, bindingId, timeoutMs, help, version, inputJson, flags };
}

function findDefinition(
  registry: CapabilityRegistry,
  identityText: string,
): CapabilityDefinition<unknown, unknown> | undefined {
  return registry.definitions.find(
    (definition) => canonicalCapabilityId(definition.identity) === identityText,
  );
}

function fieldProperties(
  definition: CapabilityDefinition<unknown, unknown>,
): Record<string, unknown> {
  const schema = definition.input.toJSONSchema();
  const properties = schema['properties'];
  return typeof properties === 'object' && properties !== null && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
}

function parseTypedFlag(value: string, schemaValue: unknown, key: string): unknown {
  if (typeof schemaValue !== 'object' || schemaValue === null || Array.isArray(schemaValue)) {
    throw new TypeError(`--${key} requires --input-json because its schema is complex`);
  }
  const schema = schemaValue as Record<string, unknown>;
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) {
    const matched = enumValues.find((candidate: unknown) => String(candidate) === value);
    if (matched === undefined)
      throw new TypeError(`--${key} must match one of its declared values`);
    return matched;
  }
  switch (schema['type']) {
    case 'string':
      return value;
    case 'number':
    case 'integer': {
      const number = Number(value);
      if (!Number.isFinite(number) || (schema['type'] === 'integer' && !Number.isInteger(number))) {
        throw new TypeError(`--${key} must be a valid ${schema['type']}`);
      }
      return number;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') {
        throw new TypeError(`--${key} must be true or false`);
      }
      return value === 'true';
    default:
      throw new TypeError(`--${key} requires --input-json because its schema is complex`);
  }
}

async function createInput(
  definition: CapabilityDefinition<unknown, unknown>,
  parsed: ParsedArguments,
  streams: CliStreams,
): Promise<unknown> {
  if (parsed.inputJson !== undefined) {
    try {
      const serialized = parsed.inputJson === '-' ? await streams.readStdin?.() : parsed.inputJson;
      if (serialized === undefined) throw new TypeError('stdin is not available');
      return JSON.parse(serialized) as unknown;
    } catch {
      throw new TypeError('--input-json must contain valid JSON');
    }
  }
  const properties = fieldProperties(definition);
  const input: Record<string, unknown> = {};
  for (const [flag, value] of parsed.flags) {
    const key = flag.replaceAll('-', '');
    const propertyName = Object.keys(properties).find(
      (candidate) => candidate.replaceAll('-', '').toLowerCase() === key.toLowerCase(),
    );
    if (propertyName === undefined) throw new TypeError(`unknown field flag: --${flag}`);
    input[propertyName] = parseTypedFlag(value, properties[propertyName], flag);
  }
  return input;
}

function hasCliBinding(
  registry: CapabilityRegistry,
  definition: CapabilityDefinition<unknown, unknown>,
  mode?: 'local' | 'remote',
  bindingId?: string,
): boolean {
  const id = canonicalCapabilityId(definition.identity);
  const local = registry.bindings.filter(
    (binding) =>
      binding.capabilityId === id &&
      binding.targets.includes('local') &&
      (bindingId === undefined || binding.id === bindingId),
  );
  const server = registry.bindings.filter(
    (binding) => binding.capabilityId === id && binding.targets.includes('server'),
  );
  const publicRead = definition.risk === 'read' && definition.access.kind === 'public';

  if (mode === 'local' || bindingId !== undefined) return local.length === 1;
  if (mode === 'remote') return publicRead && server.length === 1;
  return local.length === 1 || (publicRead && server.length === 1);
}

function helpText(
  registry: CapabilityRegistry,
  packageVersion: string,
  selected?: CapabilityDefinition<unknown, unknown>,
  visibleDefinitions: readonly CapabilityDefinition<unknown, unknown>[] = registry.definitions,
): string {
  const lines = [
    `@uppercut-labs/agent-native ${packageVersion} | CLI result ${CLI_RESULT_SCHEMA_VERSION}`,
    'Usage: <application-cli> <namespace:name@major> --mode local|remote [options]',
    'Local executes an exact registered local binding; remote invokes the generated HTTP route.',
    'Options: --input-json JSON, --<field> VALUE, --binding-id ID, --profile NAME, --timeout-ms MS',
    'Simple string, number, integer, boolean and enum fields use typed flags; object/array fields use --input-json.',
    'Remote mode requires an explicit credential profile.',
    '',
    'Capabilities:',
  ];
  for (const definition of selected === undefined ? visibleDefinitions : [selected]) {
    lines.push(`  ${canonicalCapabilityId(definition.identity)}  ${definition.description}`);
    for (const [key, schemaValue] of Object.entries(fieldProperties(definition))) {
      const schema =
        typeof schemaValue === 'object' && schemaValue !== null && !Array.isArray(schemaValue)
          ? (schemaValue as Record<string, unknown>)
          : {};
      const type = Array.isArray(schema['enum'])
        ? `enum(${schema['enum'].map(String).join('|')})`
        : String(schema['type'] ?? 'json');
      lines.push(`    --${key} <${type}>`);
    }
  }
  return lines.join('\n') + '\n';
}

function normalizeLocal(result: ExecutionResult): CliResult {
  if (result.kind === 'failure') {
    return { kind: 'failure', reason: result.reason };
  }
  return { kind: 'success', capabilityId: result.capabilityId, value: result.value };
}

function remoteFailure(status: number): CliFailure {
  if (status === 400) return { kind: 'failure', reason: 'invalid-json' };
  if (status === 404) return { kind: 'failure', reason: 'capability-missing' };
  if (status === 413) return { kind: 'failure', reason: 'request-too-large' };
  if (status === 415) return { kind: 'failure', reason: 'unsupported-content-type' };
  if (status === 422) return { kind: 'failure', reason: 'invalid-input' };
  if (status === 503) return { kind: 'failure', reason: 'binding-unavailable' };
  if (status === 504) return { kind: 'failure', reason: 'deadline-exceeded' };
  return { kind: 'failure', reason: 'remote-execution-failed' };
}

async function invokeRemote(
  definition: CapabilityDefinition<unknown, unknown>,
  input: unknown,
  profile: CliCredentialProfile,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<CliResult> {
  let url: URL;
  try {
    const baseUrl = new URL(profile.baseUrl);
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
    if (
      baseUrl.username !== '' ||
      baseUrl.password !== '' ||
      (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && localHost))
    ) {
      return { kind: 'failure', reason: 'insecure-profile-url' };
    }
    url = new URL(httpInvocationPath(definition.identity), baseUrl);
  } catch {
    return { kind: 'failure', reason: 'invalid-profile-url' };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = async (): Promise<CliResult> => {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${profile.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) return remoteFailure(response.status);
    const value: unknown = await response.json();
    let validatedValue: unknown;
    try {
      validatedValue = definition.output.parse(value);
    } catch {
      return { kind: 'failure', reason: 'invalid-output' };
    }
    return {
      kind: 'success',
      capabilityId: canonicalCapabilityId(definition.identity),
      value: validatedValue,
    };
  };
  const timeout = new Promise<CliResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'failure', reason: 'deadline-exceeded' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(), timeout]);
  } catch {
    if (controller.signal.aborted) return { kind: 'failure', reason: 'deadline-exceeded' };
    return { kind: 'failure', reason: 'remote-unavailable' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function writeFailure(streams: CliStreams, reason: string, mode?: 'local' | 'remote'): number {
  streams.writeStderr('error=' + reason + '\n');
  streams.writeStdout(
    JSON.stringify({
      schemaVersion: CLI_RESULT_SCHEMA_VERSION,
      target: mode === undefined ? {} : { mode },
      result: { kind: 'failure', reason },
    }) + '\n',
  );
  return reason === 'unauthorized' ? 3 : reason === 'invalid-input' ? 2 : 1;
}

export async function runCapabilityCli(
  argv: readonly string[],
  options: CapabilityCliOptions,
  streams: CliStreams,
): Promise<number> {
  const packageVersion = options.packageVersion ?? '0.0.0';
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    return writeFailure(streams, error instanceof Error ? error.message : 'invalid-arguments');
  }

  if (parsed.version) {
    streams.writeStdout(`@uppercut-labs/agent-native ${packageVersion}\n`);
    return 0;
  }
  if (parsed.help) {
    const selected =
      parsed.identity === undefined ? undefined : findDefinition(options.registry, parsed.identity);
    if (parsed.identity !== undefined && selected === undefined) {
      streams.writeStdout('Capability is unavailable or not visible.\n');
      return 0;
    }
    const candidates = selected === undefined ? options.registry.definitions : [selected];
    const visible: CapabilityDefinition<unknown, unknown>[] = [];
    for (const definition of candidates) {
      if (!hasCliBinding(options.registry, definition, parsed.mode, parsed.bindingId)) continue;
      const decision = await evaluateCapabilityDiscovery(
        definition,
        'cli',
        options.surfaceExposure,
        options.canDiscover,
      );
      if (decision.visible) visible.push(definition);
    }
    if (parsed.identity !== undefined && visible.length === 0) {
      streams.writeStdout('Capability is unavailable or not visible.\n');
      return 0;
    }
    streams.writeStdout(
      helpText(
        options.registry,
        packageVersion,
        parsed.identity === undefined ? undefined : visible[0],
        visible,
      ),
    );
    return 0;
  }
  if (parsed.identity === undefined) return writeFailure(streams, 'capability-identity-required');
  if (parsed.mode === undefined) return writeFailure(streams, 'execution-mode-required');
  if (
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*:[a-z0-9]+(?:[.-][a-z0-9]+)*@[1-9][0-9]*$/.test(parsed.identity)
  ) {
    return writeFailure(streams, 'invalid-capability-identity', parsed.mode);
  }

  let definition: CapabilityDefinition<unknown, unknown> | undefined;
  try {
    definition = findDefinition(options.registry, parsed.identity);
  } catch {
    return writeFailure(streams, 'invalid-capability-identity');
  }
  if (definition === undefined) return writeFailure(streams, 'capability-missing');
  if (!hasCliBinding(options.registry, definition, parsed.mode, parsed.bindingId)) {
    return writeFailure(streams, 'capability-unavailable', parsed.mode);
  }
  if (!isDestructiveCapabilityExposed(definition, 'cli', options.surfaceExposure)) {
    return writeFailure(streams, 'capability-unavailable', parsed.mode);
  }

  let input: unknown;
  try {
    input = await createInput(definition, parsed, streams);
  } catch (error) {
    return writeFailure(streams, error instanceof Error ? error.message : 'invalid-input');
  }

  streams.writeStderr(
    `target=${parsed.mode} capability=${canonicalCapabilityId(definition.identity)}${parsed.profile === undefined ? '' : ` profile=${parsed.profile}`}\n`,
  );

  let result: CliResult;
  if (parsed.mode === 'local') {
    result = normalizeLocal(
      await executeCapability(options.registry, {
        identity: definition.identity,
        runtime: 'local',
        input,
        caller: options.caller,
        authorization: options.authorization,
        ...(parsed.bindingId === undefined ? {} : { bindingId: parsed.bindingId }),
      }),
    );
  } else {
    if (parsed.profile === undefined)
      return writeFailure(streams, 'credential-profile-required', parsed.mode);
    const profiles = options.credentialProfiles;
    const profile =
      profiles !== undefined && Object.hasOwn(profiles, parsed.profile)
        ? profiles[parsed.profile]
        : undefined;
    if (
      profile === undefined ||
      typeof profile.token !== 'string' ||
      profile.token.trim().length === 0
    ) {
      return writeFailure(streams, 'credential-profile-unavailable', parsed.mode);
    }
    result = await invokeRemote(
      definition,
      input,
      profile,
      parsed.timeoutMs,
      options.fetcher ?? fetch,
    );
  }

  if (result.kind === 'failure') streams.writeStderr('execution=' + result.reason + '\n');

  const envelope =
    result.kind === 'success'
      ? {
          schemaVersion: CLI_RESULT_SCHEMA_VERSION,
          target: {
            mode: parsed.mode,
            capabilityId: result.capabilityId,
            ...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
          },
          result,
        }
      : { schemaVersion: CLI_RESULT_SCHEMA_VERSION, target: { mode: parsed.mode }, result };
  let serializedEnvelope: string | undefined;
  try {
    serializedEnvelope = JSON.stringify(envelope);
  } catch {
    return writeFailure(streams, 'result-serialization-failed', parsed.mode);
  }
  if (serializedEnvelope === undefined) {
    return writeFailure(streams, 'result-serialization-failed', parsed.mode);
  }
  streams.writeStdout(serializedEnvelope + '\n');
  if (result.kind === 'failure') {
    return result.reason === 'unauthorized' ? 3 : result.reason === 'invalid-input' ? 2 : 1;
  }
  return 0;
}
