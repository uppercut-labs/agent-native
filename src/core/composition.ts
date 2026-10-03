import {
  type CapabilityDefinition,
  type CapabilityIdentity,
  canonicalCapabilityId,
} from './contracts.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MCP_NAME_LIMIT = 128;

export type CapabilityPackIdentity = {
  readonly authority: string;
  readonly namespace: string;
};

export type CapabilityPack = {
  readonly identity: CapabilityPackIdentity;
  readonly source: string;
  readonly definitions: readonly CapabilityDefinition<unknown, unknown>[];
};

export type CapabilityPackOptions = CapabilityPack;

export type CapabilityAlias = {
  readonly name: string;
  readonly capabilityId: string;
  readonly source?: string;
};

export type CapabilityAliasPolicy =
  | { readonly kind: 'none' }
  | { readonly kind: 'explicit'; readonly aliases: readonly CapabilityAlias[] };

export type CapabilityPackImport = {
  readonly pack: CapabilityPack;
  readonly source: string;
  readonly aliasPolicy: CapabilityAliasPolicy;
};

export type CapabilitySurfaceNames = {
  readonly cli: string;
  readonly http: string;
  readonly mcp: string;
  readonly openApiOperation: string;
};

export type CapabilityComposition = {
  readonly definitions: readonly CapabilityDefinition<unknown, unknown>[];
  readonly aliases: ReadonlyMap<string, string>;
  readonly surfaceNames: ReadonlyMap<string, CapabilitySurfaceNames>;
  resolve(name: string): CapabilityDefinition<unknown, unknown> | undefined;
};

export class CapabilityCompositionError extends Error {
  public readonly kind:
    | 'invalid-pack'
    | 'duplicate-identity'
    | 'alias-collision'
    | 'surface-collision';

  public constructor(kind: CapabilityCompositionError['kind'], message: string) {
    super(message);
    this.name = 'CapabilityCompositionError';
    this.kind = kind;
  }
}

function assertSource(source: string, label: string): void {
  if (source.trim().length === 0) throw new TypeError(`${label} must identify a source location`);
}

function packNamespace(identity: CapabilityPackIdentity): string {
  if (!SLUG_PATTERN.test(identity.authority) || !SLUG_PATTERN.test(identity.namespace)) {
    throw new TypeError('pack authority and namespace must be lowercase capability slugs');
  }
  return `${identity.authority}.${identity.namespace}`;
}

export function defineCapabilityPack(options: CapabilityPackOptions): CapabilityPack {
  const namespace = packNamespace(options.identity);
  assertSource(options.source, 'pack source');
  for (const definition of options.definitions) {
    if (definition.identity.namespace !== namespace) {
      throw new CapabilityCompositionError(
        'invalid-pack',
        `pack ${options.source} owns namespace ${namespace}, but ${canonicalCapabilityId(definition.identity)} uses ${definition.identity.namespace}`,
      );
    }
  }
  return Object.freeze({
    identity: Object.freeze({ ...options.identity }),
    source: options.source.trim(),
    definitions: Object.freeze([...options.definitions]),
  });
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function lengthEncoded(identity: CapabilityIdentity): string {
  return `${identity.namespace.length}_${identity.namespace}_${identity.name.length}_${identity.name}_v${identity.majorVersion}`;
}

function readonlyMap<Key, Value>(source: Map<Key, Value>): ReadonlyMap<Key, Value> {
  let view: ReadonlyMap<Key, Value>;
  view = Object.freeze({
    size: source.size,
    get(key: Key) {
      return source.get(key);
    },
    has(key: Key) {
      return source.has(key);
    },
    entries() {
      return source.entries();
    },
    keys() {
      return source.keys();
    },
    values() {
      return source.values();
    },
    forEach(
      callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
      thisArg?: unknown,
    ) {
      source.forEach((value, key) => {
        callback.call(thisArg, value, key, view);
      });
    },
    [Symbol.iterator]() {
      return source[Symbol.iterator]();
    },
  });
  return view;
}

export function capabilitySurfaceNames(identity: CapabilityIdentity): CapabilitySurfaceNames {
  const canonical = canonicalCapabilityId(identity);
  const encoded = lengthEncoded(identity);
  const fullMcpName = `cap_${encoded}`;
  const mcp =
    fullMcpName.length <= MCP_NAME_LIMIT
      ? fullMcpName
      : `cap_${fullMcpName.slice(4, 101)}_fnv1a64_${fnv1a64(canonical)}`;
  return Object.freeze({
    cli: canonical,
    http: `/capabilities/${encodeURIComponent(identity.namespace)}/${encodeURIComponent(identity.name)}/v${identity.majorVersion}/invoke`,
    mcp,
    openApiOperation: `invoke_${encoded}`,
  });
}

function surfaceMap(
  definitions: readonly CapabilityDefinition<unknown, unknown>[],
  sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, CapabilitySurfaceNames> {
  const result = new Map<string, CapabilitySurfaceNames>();
  const owners = new Map<string, { readonly id: string; readonly source: string }>();
  for (const definition of definitions) {
    const id = canonicalCapabilityId(definition.identity);
    const names = capabilitySurfaceNames(definition.identity);
    for (const [surface, name] of Object.entries(names)) {
      const key = `${surface}:${name}`;
      const previous = owners.get(key);
      if (previous !== undefined && previous.id !== id) {
        throw new CapabilityCompositionError(
          'surface-collision',
          `${surface} name ${name} maps both ${previous.id} from ${previous.source} and ${id} from ${sources.get(id) ?? 'unknown source'}`,
        );
      }
      owners.set(key, { id, source: sources.get(id) ?? 'unknown source' });
    }
    result.set(id, names);
  }
  return result;
}

export function createCapabilitySurfaceMap(
  definitions: readonly CapabilityDefinition<unknown, unknown>[],
): ReadonlyMap<string, CapabilitySurfaceNames> {
  return readonlyMap(new Map(surfaceMap(definitions, new Map())));
}

export function composeCapabilityPacks(
  imports: readonly CapabilityPackImport[],
): CapabilityComposition {
  const definitions: CapabilityDefinition<unknown, unknown>[] = [];
  const byId = new Map<string, CapabilityDefinition<unknown, unknown>>();
  const sources = new Map<string, string>();
  const aliases = new Map<string, string>();
  const aliasSources = new Map<string, string>();

  for (const imported of imports) {
    assertSource(imported.source, 'import source');
    if (imported.aliasPolicy?.kind !== 'none' && imported.aliasPolicy?.kind !== 'explicit') {
      throw new CapabilityCompositionError(
        'invalid-pack',
        `pack import ${imported.source} must declare aliasPolicy as none or explicit`,
      );
    }
    for (const definition of imported.pack.definitions) {
      const id = canonicalCapabilityId(definition.identity);
      const previousSource = sources.get(id);
      if (previousSource !== undefined) {
        throw new CapabilityCompositionError(
          'duplicate-identity',
          `duplicate capability identity ${id}: ${previousSource} conflicts with ${imported.source}`,
        );
      }
      sources.set(id, imported.source);
      byId.set(id, definition);
      definitions.push(definition);
    }
  }

  for (const imported of imports) {
    if (imported.aliasPolicy.kind === 'none') continue;
    for (const alias of imported.aliasPolicy.aliases) {
      const source = alias.source?.trim() || imported.source;
      if (!SLUG_PATTERN.test(alias.name)) {
        throw new CapabilityCompositionError(
          'alias-collision',
          `alias ${alias.name} from ${source} must be a lowercase capability slug`,
        );
      }
      if (!byId.has(alias.capabilityId)) {
        throw new CapabilityCompositionError(
          'alias-collision',
          `alias ${alias.name} from ${source} targets missing capability ${alias.capabilityId}`,
        );
      }
      const previousSource = aliasSources.get(alias.name);
      if (previousSource !== undefined) {
        throw new CapabilityCompositionError(
          'alias-collision',
          `duplicate alias ${alias.name}: ${previousSource} conflicts with ${source}`,
        );
      }
      aliases.set(alias.name, alias.capabilityId);
      aliasSources.set(alias.name, source);
    }
  }

  const names = surfaceMap(definitions, sources);
  return Object.freeze({
    definitions: Object.freeze(definitions),
    aliases: readonlyMap(aliases),
    surfaceNames: readonlyMap(new Map(names)),
    resolve(name: string) {
      return byId.get(aliases.get(name) ?? name);
    },
  });
}
