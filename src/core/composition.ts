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
  readonly migrations?: readonly CapabilityMigration[];
  readonly lifecycle?: CapabilityLifecyclePolicy;
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
  select(identity: CapabilityIdentity): CapabilityDefinition<unknown, unknown> | undefined;
};

export type CapabilityContractChange = {
  readonly area: 'input' | 'output' | 'risk' | 'access' | 'surface';
  readonly kind:
    | 'property-added'
    | 'property-removed'
    | 'property-renamed'
    | 'required-added'
    | 'required-removed'
    | 'value-changed';
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly breaking: boolean;
};

export type CapabilityContractChangeReport = {
  readonly fromId: string;
  readonly toId: string;
  readonly schemaEquivalent: boolean;
  readonly changes: readonly CapabilityContractChange[];
  readonly breaking: boolean;
};

export type CapabilitySemanticReview = {
  readonly note: string;
  readonly reviewedBy: string;
};

export type CapabilityMigration = {
  readonly fromId: string;
  readonly toId: string;
  readonly semanticReview: CapabilitySemanticReview;
  readonly contract: CapabilityContractChangeReport;
};

export type CapabilityMigrationOptions = {
  readonly previous: CapabilityDefinition<unknown, unknown>;
  readonly next: CapabilityDefinition<unknown, unknown>;
  readonly semanticReview: CapabilitySemanticReview;
};

export type CapabilityLifecycleEntry =
  | { readonly capabilityId: string; readonly state: 'supported' }
  | { readonly capabilityId: string; readonly state: 'deprecated'; readonly note: string }
  | {
      readonly capabilityId: string;
      readonly state: 'removed';
      readonly note: string;
      readonly reviewedBy: string;
    };

export type CapabilityLifecyclePolicy = {
  readonly entries: readonly CapabilityLifecycleEntry[];
  get(capabilityId: string): CapabilityLifecycleEntry | undefined;
};

export type CapabilityPackMigrationOptions = {
  readonly previous: CapabilityPack;
  readonly next: CapabilityPack;
  readonly migrations: readonly CapabilityMigration[];
  readonly previousLifecycle: CapabilityLifecyclePolicy;
  readonly nextLifecycle: CapabilityLifecyclePolicy;
};

export type CapabilityPackMigrationReport = {
  readonly contractChanges: readonly CapabilityContractChangeReport[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
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

export class CapabilityMigrationError extends Error {
  public readonly kind:
    | 'breaking-replacement'
    | 'invalid-migration'
    | 'missing-semantic-review'
    | 'implicit-removal'
    | 'invalid-lifecycle';

  public constructor(kind: CapabilityMigrationError['kind'], message: string) {
    super(message);
    this.name = 'CapabilityMigrationError';
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

function assertPackOwnership(
  identity: CapabilityPackIdentity,
  definitions: readonly CapabilityDefinition<unknown, unknown>[],
  source: string,
): void {
  const namespace = packNamespace(identity);
  for (const definition of definitions) {
    if (definition.identity.namespace !== namespace) {
      throw new CapabilityCompositionError(
        'invalid-pack',
        `pack ${source} owns namespace ${namespace}, but ${canonicalCapabilityId(definition.identity)} uses ${definition.identity.namespace}`,
      );
    }
  }
}

function verifiedLifecyclePolicy(policy: CapabilityLifecyclePolicy): CapabilityLifecyclePolicy {
  if (!Array.isArray(policy?.entries)) {
    throw new CapabilityMigrationError('invalid-lifecycle', 'lifecycle entries must be an array');
  }
  return defineCapabilityLifecyclePolicy(policy.entries);
}

export function defineCapabilityPack(options: CapabilityPackOptions): CapabilityPack {
  assertSource(options.source, 'pack source');
  assertPackOwnership(options.identity, options.definitions, options.source);
  const lifecycle =
    options.lifecycle === undefined ? undefined : verifiedLifecyclePolicy(options.lifecycle);
  const reviewedMigrations: CapabilityMigration[] = [];
  const families = new Map<string, CapabilityDefinition<unknown, unknown>[]>();
  for (const definition of options.definitions) {
    const key = `${definition.identity.namespace}:${definition.identity.name}`;
    const family = families.get(key) ?? [];
    family.push(definition);
    families.set(key, family);
  }
  for (const family of families.values()) {
    if (family.length < 2) continue;
    const ordered = family.sort(
      (left, right) => left.identity.majorVersion - right.identity.majorVersion,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const next = ordered[index];
      if (previous === undefined || next === undefined) continue;
      const fromId = canonicalCapabilityId(previous.identity);
      const toId = canonicalCapabilityId(next.identity);
      const migration = options.migrations?.find(
        (entry) => entry.fromId === fromId && entry.toId === toId,
      );
      if (migration === undefined) {
        throw new CapabilityMigrationError(
          'missing-semantic-review',
          `pack ${options.source} requires a reviewed migration for ${fromId} -> ${toId}`,
        );
      }
      const reviewed = defineCapabilityMigration({
        previous,
        next,
        semanticReview: migration.semanticReview,
      });
      if (stableValue(migration.contract) !== stableValue(reviewed.contract)) {
        throw new CapabilityMigrationError(
          'invalid-migration',
          `migration ${fromId} -> ${toId} contains a contract report that does not match its definitions`,
        );
      }
      reviewedMigrations.push(reviewed);
    }
    for (const definition of ordered) {
      const id = canonicalCapabilityId(definition.identity);
      const state = lifecycle?.get(id);
      if (state === undefined || state.state === 'removed') {
        throw new CapabilityMigrationError(
          'invalid-lifecycle',
          `versioned pack ${options.source} requires an explicit supported or deprecated state for ${id}`,
        );
      }
    }
  }
  if ((options.migrations?.length ?? 0) !== reviewedMigrations.length) {
    throw new CapabilityMigrationError(
      'invalid-migration',
      `pack ${options.source} contains an unmatched or duplicate migration record`,
    );
  }
  return Object.freeze({
    identity: Object.freeze({ ...options.identity }),
    source: options.source.trim(),
    definitions: Object.freeze([...options.definitions]),
    ...(options.migrations === undefined ? {} : { migrations: Object.freeze(reviewedMigrations) }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? 'undefined';
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
    .join(',')}}`;
}

function schemaChanges(
  area: 'input' | 'output',
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  path = '$',
): CapabilityContractChange[] {
  const changes: CapabilityContractChange[] = [];
  const beforeProperties = isRecord(before['properties']) ? before['properties'] : {};
  const afterProperties = isRecord(after['properties']) ? after['properties'] : {};
  const removed = Object.keys(beforeProperties).filter((key) => !(key in afterProperties));
  const added = Object.keys(afterProperties).filter((key) => !(key in beforeProperties));
  const pairedAdded = new Set<string>();
  const pairedRemoved = new Set<string>();

  for (const oldName of removed) {
    const candidates = added.filter(
      (newName) =>
        !pairedAdded.has(newName) &&
        stableValue(beforeProperties[oldName]) === stableValue(afterProperties[newName]),
    );
    if (candidates.length === 1) {
      const newName = candidates[0];
      if (newName !== undefined) {
        pairedRemoved.add(oldName);
        pairedAdded.add(newName);
        changes.push({
          area,
          kind: 'property-renamed',
          path: `${path}.properties.${oldName}`,
          before: oldName,
          after: newName,
          breaking: true,
        });
      }
    }
  }
  for (const name of removed) {
    if (!pairedRemoved.has(name)) {
      changes.push({
        area,
        kind: 'property-removed',
        path: `${path}.properties.${name}`,
        before: beforeProperties[name],
        breaking: true,
      });
    }
  }
  for (const name of added) {
    if (!pairedAdded.has(name)) {
      changes.push({
        area,
        kind: 'property-added',
        path: `${path}.properties.${name}`,
        after: afterProperties[name],
        breaking:
          area === 'input' ||
          (area === 'output' &&
            (('additionalProperties' in before && before['additionalProperties'] !== true) ||
              ('unevaluatedProperties' in before && before['unevaluatedProperties'] !== true))),
      });
    }
  }

  const beforeRequired = new Set(
    Array.isArray(before['required'])
      ? before['required'].filter((value): value is string => typeof value === 'string')
      : [],
  );
  const afterRequired = new Set(
    Array.isArray(after['required'])
      ? after['required'].filter((value): value is string => typeof value === 'string')
      : [],
  );
  for (const name of afterRequired) {
    if (!beforeRequired.has(name)) {
      changes.push({
        area,
        kind: 'required-added',
        path: `${path}.required`,
        after: name,
        breaking: area === 'input',
      });
    }
  }
  for (const name of beforeRequired) {
    if (!afterRequired.has(name)) {
      changes.push({
        area,
        kind: 'required-removed',
        path: `${path}.required`,
        before: name,
        breaking: area === 'output',
      });
    }
  }

  for (const name of Object.keys(beforeProperties)) {
    if (
      !(name in afterProperties) ||
      !isRecord(beforeProperties[name]) ||
      !isRecord(afterProperties[name])
    ) {
      continue;
    }
    changes.push(
      ...schemaChanges(
        area,
        beforeProperties[name],
        afterProperties[name],
        `${path}.properties.${name}`,
      ),
    );
  }

  const handled = new Set(['properties', 'required', 'title', 'description', '$schema']);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (handled.has(key) || stableValue(before[key]) === stableValue(after[key])) continue;
    changes.push({
      area,
      kind: 'value-changed',
      path: `${path}.${key}`,
      ...(key in before ? { before: before[key] } : {}),
      ...(key in after ? { after: after[key] } : {}),
      breaking: true,
    });
  }
  return changes;
}

export function compareCapabilityDefinitions(
  previous: CapabilityDefinition<unknown, unknown>,
  next: CapabilityDefinition<unknown, unknown>,
): CapabilityContractChangeReport {
  const fromId = canonicalCapabilityId(previous.identity);
  const toId = canonicalCapabilityId(next.identity);
  const changes = [
    ...schemaChanges('input', previous.input.toJSONSchema(), next.input.toJSONSchema()),
    ...schemaChanges('output', previous.output.toJSONSchema(), next.output.toJSONSchema()),
  ];
  if (previous.risk !== next.risk) {
    changes.push({
      area: 'risk',
      kind: 'value-changed',
      path: '$.risk',
      before: previous.risk,
      after: next.risk,
      breaking: true,
    });
  }
  if (stableValue(previous.access) !== stableValue(next.access)) {
    changes.push({
      area: 'access',
      kind: 'value-changed',
      path: '$.access',
      before: previous.access,
      after: next.access,
      breaking: true,
    });
  }
  if (stableValue(previous.surfaces) !== stableValue(next.surfaces)) {
    changes.push({
      area: 'surface',
      kind: 'value-changed',
      path: '$.surfaces',
      ...(previous.surfaces === undefined ? {} : { before: previous.surfaces }),
      ...(next.surfaces === undefined ? {} : { after: next.surfaces }),
      breaking: true,
    });
  }
  return Object.freeze({
    fromId,
    toId,
    schemaEquivalent: changes.every(
      (change) => change.area === 'risk' || change.area === 'access' || change.area === 'surface',
    ),
    changes: Object.freeze(changes),
    breaking: changes.some((change) => change.breaking),
  });
}

function assertSemanticReview(review: CapabilitySemanticReview): CapabilitySemanticReview {
  if (typeof review !== 'object' || review === null) {
    throw new CapabilityMigrationError(
      'missing-semantic-review',
      'a major migration requires a substantive semantic note and named reviewer',
    );
  }
  const note = typeof review.note === 'string' ? review.note.trim() : '';
  const reviewedBy = typeof review.reviewedBy === 'string' ? review.reviewedBy.trim() : '';
  if (
    note.length < 12 ||
    reviewedBy.length < 3 ||
    /^(?:tbd|todo|n\/?a|none|no change|same)$/i.test(note)
  ) {
    throw new CapabilityMigrationError(
      'missing-semantic-review',
      'a major migration requires a substantive semantic note and named reviewer',
    );
  }
  return Object.freeze({ note, reviewedBy });
}

export function defineCapabilityMigration(
  options: CapabilityMigrationOptions,
): CapabilityMigration {
  const { previous, next } = options;
  if (
    previous.identity.namespace !== next.identity.namespace ||
    previous.identity.name !== next.identity.name ||
    previous.identity.majorVersion >= next.identity.majorVersion
  ) {
    throw new CapabilityMigrationError(
      'invalid-migration',
      'a major migration must connect an older major to a newer major of the same namespace and name',
    );
  }
  const semanticReview = assertSemanticReview(options.semanticReview);
  const contract = compareCapabilityDefinitions(previous, next);
  return Object.freeze({
    fromId: contract.fromId,
    toId: contract.toId,
    semanticReview,
    contract,
  });
}

export function assertCompatibleCapabilityReplacement(
  previous: CapabilityDefinition<unknown, unknown>,
  next: CapabilityDefinition<unknown, unknown>,
): CapabilityContractChangeReport {
  const report = compareCapabilityDefinitions(previous, next);
  if (report.fromId !== report.toId) {
    throw new CapabilityMigrationError(
      'invalid-migration',
      'replacement validation requires an unchanged canonical identity',
    );
  }
  if (report.breaking) {
    throw new CapabilityMigrationError(
      'breaking-replacement',
      `breaking contract changes cannot replace ${report.fromId} without a new major identity`,
    );
  }
  return report;
}

export function defineCapabilityLifecyclePolicy(
  entries: readonly CapabilityLifecycleEntry[],
): CapabilityLifecyclePolicy {
  const byId = new Map<string, CapabilityLifecycleEntry>();
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.capabilityId !== 'string' ||
      (entry.state !== 'supported' && entry.state !== 'deprecated' && entry.state !== 'removed')
    ) {
      throw new CapabilityMigrationError('invalid-lifecycle', 'invalid lifecycle entry');
    }
    if (byId.has(entry.capabilityId)) {
      throw new CapabilityMigrationError(
        'invalid-lifecycle',
        `duplicate lifecycle state for ${entry.capabilityId}`,
      );
    }
    if (entry.state !== 'supported') {
      const note = typeof entry.note === 'string' ? entry.note.trim() : '';
      const reviewedBy =
        entry.state === 'removed' && typeof entry.reviewedBy === 'string'
          ? entry.reviewedBy.trim()
          : '';
      if (note.length < 12 || (entry.state === 'removed' && reviewedBy.length < 3)) {
        throw new CapabilityMigrationError(
          'invalid-lifecycle',
          `${entry.state} lifecycle state for ${entry.capabilityId} requires an explicit note${entry.state === 'removed' ? ' and reviewer' : ''}`,
        );
      }
    }
    byId.set(entry.capabilityId, Object.freeze({ ...entry }));
  }
  const frozenEntries = Object.freeze([...byId.values()]);
  return Object.freeze({
    entries: frozenEntries,
    get(capabilityId: string) {
      return byId.get(capabilityId);
    },
  });
}

export function validateCapabilityPackMigration(
  options: CapabilityPackMigrationOptions,
): CapabilityPackMigrationReport {
  if (
    options.previous.identity.authority !== options.next.identity.authority ||
    options.previous.identity.namespace !== options.next.identity.namespace
  ) {
    throw new CapabilityMigrationError(
      'invalid-migration',
      'pack migration must compare the same authority and namespace',
    );
  }
  const previousLifecycle = verifiedLifecyclePolicy(options.previousLifecycle);
  const nextLifecycle = verifiedLifecyclePolicy(options.nextLifecycle);
  const previous = new Map(
    options.previous.definitions.map((definition) => [
      canonicalCapabilityId(definition.identity),
      definition,
    ]),
  );
  const next = new Map(
    options.next.definitions.map((definition) => [
      canonicalCapabilityId(definition.identity),
      definition,
    ]),
  );
  const migrations = new Map(
    options.migrations.map((migration) => [`${migration.fromId}->${migration.toId}`, migration]),
  );
  const contractChanges: CapabilityContractChangeReport[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [id, definition] of previous) {
    const priorState = previousLifecycle.get(id);
    if (priorState === undefined || priorState.state === 'removed') {
      throw new CapabilityMigrationError(
        'invalid-lifecycle',
        `previous definition ${id} requires an explicit supported or deprecated lifecycle state`,
      );
    }
    const replacement = next.get(id);
    if (replacement !== undefined) {
      contractChanges.push(assertCompatibleCapabilityReplacement(definition, replacement));
      continue;
    }
    const nextState = nextLifecycle.get(id);
    if (priorState?.state !== 'deprecated' || nextState?.state !== 'removed') {
      throw new CapabilityMigrationError(
        'implicit-removal',
        `cannot remove supported major ${id}; deprecate it in an earlier policy and record an explicit reviewed removal`,
      );
    }
    removed.push(id);
  }

  for (const [id, definition] of next) {
    const state = nextLifecycle.get(id);
    if (state === undefined || state.state === 'removed') {
      throw new CapabilityMigrationError(
        'invalid-lifecycle',
        `current definition ${id} requires an explicit supported or deprecated lifecycle state`,
      );
    }
    if (previous.has(id)) continue;
    added.push(id);
    const candidate = [...previous.entries()]
      .filter(
        ([, old]) =>
          old.identity.namespace === definition.identity.namespace &&
          old.identity.name === definition.identity.name &&
          old.identity.majorVersion < definition.identity.majorVersion,
      )
      .sort(([, left], [, right]) => right.identity.majorVersion - left.identity.majorVersion)[0];
    if (candidate !== undefined) {
      const [oldId, oldDefinition] = candidate;
      const migration = migrations.get(`${oldId}->${id}`);
      if (migration === undefined) {
        throw new CapabilityMigrationError(
          'missing-semantic-review',
          `major migration ${oldId} -> ${id} requires an explicit semantic review`,
        );
      }
      const reviewed = defineCapabilityMigration({
        previous: oldDefinition,
        next: definition,
        semanticReview: migration.semanticReview,
      });
      contractChanges.push(reviewed.contract);
    }
  }

  return Object.freeze({
    contractChanges: Object.freeze(contractChanges),
    added: Object.freeze(added),
    removed: Object.freeze(removed),
  });
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
    assertPackOwnership(imported.pack.identity, imported.pack.definitions, imported.source);
    defineCapabilityPack(imported.pack);
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
    select(identity: CapabilityIdentity) {
      return byId.get(canonicalCapabilityId(identity));
    },
  });
}
