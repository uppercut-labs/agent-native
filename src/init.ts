import { createHash } from 'node:crypto';
import {
  lstat,
  link,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const INIT_PLAN_VERSION = 'uan.init-plan/v1';
export const INIT_OWNERSHIP_VERSION = 'uan.init-ownership/v1';

export type InitFramework = 'astro' | 'unknown';
export type InitRendering = 'static' | 'on-demand' | 'server' | 'unknown';
export type InitPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
export type InitHosting = 'browser-only' | 'cloudflare' | 'vercel' | 'netlify' | 'unknown';
export type InitRouteMode = 'sidecar' | 'same-origin';

export type InitOverrides = {
  readonly appRoot?: string;
  readonly framework?: InitFramework;
  readonly hosting?: InitHosting;
  readonly packageManager?: Exclude<InitPackageManager, 'unknown'>;
};

export type InitDetection = {
  readonly projectRoot: string;
  readonly applicationRoot: string | null;
  readonly astroConfigPath: string | null;
  readonly astroConfigSha256: string | null;
  readonly framework: InitFramework;
  readonly rendering: InitRendering;
  readonly serverAdapter: boolean;
  readonly onDemandRoutes: readonly string[];
  readonly staticProtocolFiles: readonly string[];
  readonly packageManager: InitPackageManager;
  readonly hosting: InitHosting;
  readonly hostingConfig: string | null;
  readonly routeConflict: boolean;
  readonly evidence: readonly string[];
  readonly unresolved: readonly string[];
};

export type InitPlan = {
  readonly schemaVersion: typeof INIT_PLAN_VERSION;
  readonly detection: InitDetection;
  readonly proposedFiles: readonly string[];
  readonly dependencyChanges: readonly {
    readonly name: string;
    readonly action: 'add-after-release';
    readonly reason: string;
  }[];
  readonly manualIntegration: string | null;
  readonly planDigest: string;
  readonly alreadyInitialized: boolean;
  readonly selectedChoices: InitChoices | null;
  readonly detectionOverrides: InitOverrides;
};

export type InitChoices = {
  readonly hosting: Exclude<InitHosting, 'unknown'>;
  readonly sidecarOrigin?: string;
  readonly routeMode?: InitRouteMode;
};

export type InitApplyResult = {
  readonly status: 'applied' | 'no-op';
  readonly ownedFiles: readonly string[];
  readonly planDigest: string;
};

export type InitRestoreResult = {
  readonly status: 'restored' | 'no-op' | 'conflict';
  readonly removed: readonly string[];
  readonly conflicts: readonly string[];
};

type OwnedManifest = {
  readonly schemaVersion: typeof INIT_OWNERSHIP_VERSION;
  readonly planDigest: string;
  readonly status: 'applying' | 'applied';
  readonly applicationRoot: string | null;
  readonly astroConfigPath: string | null;
  readonly detection: InitDetection;
  readonly selectedChoices: InitChoices;
  readonly files: Readonly<
    Record<
      string,
      {
        readonly beforeSha256: string | null;
        readonly afterSha256: string;
        readonly beforeContent?: string;
      }
    >
  >;
};

type Scaffold = Readonly<Record<string, string>>;
const MANIFEST_PATH = '.agent-native/ownership.json';
const BOOTSTRAP_PATH = '.agent-native/browser-entry.mjs';
const SETTINGS_PATH = '.agent-native/init.json';
const LOCKFILES: Readonly<Record<string, Exclude<InitPackageManager, 'unknown'>>> = {
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
};

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}

async function assertNoSymlink(root: string, relativePath: string): Promise<string> {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw new Error('managed path is not normalized');
    current = path.join(current, segment);
    if (!(await exists(current))) continue;
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`refusing symlink in managed path: ${relativePath}`);
  }
  let existingParent = path.dirname(current);
  while (!(await exists(existingParent))) existingParent = path.dirname(existingParent);
  const parent = await realpath(existingParent);
  if (parent !== root && !parent.startsWith(root + path.sep)) {
    throw new Error(`managed path escapes project root: ${relativePath}`);
  }
  return current;
}

async function readOptional(root: string, relativePath: string): Promise<string | null> {
  const target = await assertNoSymlink(root, relativePath);
  if (!(await exists(target))) return null;
  return readFile(target, 'utf8');
}

async function packageInfo(directory: string): Promise<Record<string, unknown> | null> {
  try {
    const packagePath = path.join(directory, 'package.json');
    if ((await lstat(packagePath)).isSymbolicLink())
      throw new Error('refusing symlink package.json');
    const parsed: unknown = JSON.parse(await readFile(packagePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null;
    throw new Error(`cannot safely inspect package.json at ${directory}`, { cause: error });
  }
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await (await import('node:fs/promises')).readdir(directory, {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  }
}

function sourceTokens(source: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < source.length; ) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) throw new Error('unterminated comment in Astro config');
      index = close + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') {
          value += source[index + 1] ?? '';
          index += 2;
        } else {
          value += source[index]!;
          index += 1;
        }
      }
      if (source[index] !== char) throw new Error('unterminated string in Astro config');
      index += 1;
      tokens.push(`string:${value}`);
      continue;
    }
    const word = source.slice(index).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (word !== undefined) {
      tokens.push(`word:${word}`);
      index += word.length;
      continue;
    }
    if (source.startsWith('...', index)) {
      tokens.push('...');
      index += 3;
      continue;
    }
    tokens.push(char);
    index += 1;
  }
  return tokens;
}

function staticAstroOutput(source: string): {
  output: Exclude<InitRendering, 'on-demand'>;
  serverAdapter: boolean;
  dynamic: boolean;
  patchable: boolean;
} {
  const tokens = sourceTokens(source);
  const start = tokens.findIndex(
    (token, index) =>
      token === 'word:defineConfig' && tokens[index + 1] === '(' && tokens[index + 2] === '{',
  );
  if (start < 0)
    return { output: 'unknown', serverAdapter: false, dynamic: true, patchable: false };
  let depth = 0;
  let output: string | undefined;
  let serverAdapter = false;
  let end = -1;
  for (let index = start + 2; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === '{') depth += 1;
    else if (token === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    } else if (
      depth === 1 &&
      token === 'word:output' &&
      tokens[index + 1] === ':' &&
      tokens[index + 3] !== undefined &&
      (tokens[index + 2] === 'string:static' || tokens[index + 2] === 'string:server') &&
      (tokens[index + 3] === ',' || tokens[index + 3] === '}')
    ) {
      output = tokens[index + 2]!.slice('string:'.length);
    } else if (
      depth === 1 &&
      token === 'word:adapter' &&
      tokens[index + 1] === ':' &&
      tokens[index + 2] !== ',' &&
      tokens[index + 2] !== '}' &&
      tokens[index + 2] !== 'word:undefined' &&
      tokens[index + 2] !== 'word:null'
    ) {
      serverAdapter = true;
    }
  }
  if (end < 0) return { output: 'unknown', serverAdapter: false, dynamic: true, patchable: false };
  const configTokens = tokens.slice(start, end + 1);
  const dynamic = configTokens.some(
    (token, index) =>
      token === '...' ||
      token === 'word:await' ||
      token === 'word:async' ||
      (token === 'word:process' &&
        configTokens[index + 1] === '.' &&
        configTokens[index + 2] === 'word:env') ||
      (token === 'word:import' && configTokens[index + 1] === '('),
  );
  if (dynamic || output === undefined)
    return { output: 'unknown', serverAdapter, dynamic, patchable: false };
  const patchable =
    /^import\s+\{\s*defineConfig\s*\}\s+from\s+(['"])astro\/config\1;\s*export\s+default\s+defineConfig\s*\(\s*\{\s*output\s*:\s*(['"])static\2\s*,?\s*\}\s*\);\s*$/s.test(
      source,
    );
  return { output: output as 'static' | 'server', serverAdapter, dynamic: false, patchable };
}

async function inspectAstroRoutes(directory: string): Promise<{
  onDemandRoutes: string[];
  staticProtocolFiles: string[];
}> {
  const onDemandRoutes: string[] = [];
  const staticProtocolFiles: string[] = [];
  const pagesRoot = path.join(directory, 'src/pages');

  async function visit(current: string): Promise<void> {
    for (const entry of await (await import('node:fs/promises'))
      .readdir(current, {
        withFileTypes: true,
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return [];
        throw error;
      })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!/\.(?:astro|[cm]?[jt]s)$/.test(entry.name)) continue;
      const relative = path.relative(pagesRoot, absolute).split(path.sep).join('/');
      const source = await readFile(absolute, 'utf8');
      const onDemand = /export\s+const\s+prerender\s*=\s*false\b/.test(source);
      if (onDemand) onDemandRoutes.push(relative);
      if (
        /^(?:mcp(?:\.|\/)|agent-native\/v1\/)/.test(relative) &&
        (!onDemand ||
          !/export\s+(?:async\s+)?function\s+(?:POST|ALL)\b|export\s+const\s+(?:POST|ALL)\b/.test(
            source,
          ))
      ) {
        staticProtocolFiles.push(`src/pages/${relative}`);
      }
    }
  }

  await visit(pagesRoot);
  for (const relative of ['mcp', 'mcp.json']) {
    if (await exists(path.join(directory, 'public', relative)))
      staticProtocolFiles.push(`public/${relative}`);
  }
  const publicProtocolRoot = path.join(directory, 'public/agent-native/v1');
  for (const entry of await (await import('node:fs/promises'))
    .readdir(publicProtocolRoot, {
      withFileTypes: true,
    })
    .catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    })) {
    if (entry.isFile()) staticProtocolFiles.push(`public/agent-native/v1/${entry.name}`);
  }
  return { onDemandRoutes: onDemandRoutes.sort(), staticProtocolFiles: staticProtocolFiles.sort() };
}

async function astroEvidence(directory: string): Promise<{
  found: boolean;
  rendering: InitRendering;
  serverAdapter: boolean;
  onDemandRoutes: string[];
  staticProtocolFiles: string[];
  dynamic: boolean;
  routeConflict: boolean;
  patchable: boolean;
  configPath: string | null;
  configSha256: string | null;
  evidence: string[];
}> {
  const pkg = await packageInfo(directory);
  const deps = [pkg?.['dependencies'], pkg?.['devDependencies'], pkg?.['peerDependencies']].filter(
    (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
  );
  const packageHasAstro = deps.some((group) => Object.hasOwn(group, 'astro'));
  let configPath: string | null = null;
  for (const candidate of [
    'astro.config.mjs',
    'astro.config.js',
    'astro.config.ts',
    'astro.config.mts',
  ]) {
    if (await exists(path.join(directory, candidate))) {
      configPath = candidate;
      break;
    }
  }
  if (!packageHasAstro && configPath === null)
    return {
      found: false,
      rendering: 'unknown',
      serverAdapter: false,
      onDemandRoutes: [],
      staticProtocolFiles: [],
      dynamic: false,
      routeConflict: false,
      patchable: false,
      configPath: null,
      configSha256: null,
      evidence: [],
    };
  const evidence = [];
  if (packageHasAstro) evidence.push('package.json: Astro dependency');
  if (configPath === null)
    return {
      found: true,
      rendering: 'unknown',
      serverAdapter: false,
      onDemandRoutes: [],
      staticProtocolFiles: [],
      dynamic: true,
      routeConflict: await hasMcpRoute(directory),
      patchable: false,
      configPath: null,
      configSha256: null,
      evidence,
    };
  evidence.push(configPath);
  const configFile = await assertNoSymlink(await realpath(directory), configPath);
  const text = await readFile(configFile, 'utf8');
  const { output, serverAdapter, dynamic, patchable } = staticAstroOutput(text);
  const routes = await inspectAstroRoutes(directory);
  const rendering = output === 'static' && routes.onDemandRoutes.length > 0 ? 'on-demand' : output;
  if (rendering !== 'unknown') evidence.push(`literal output: ${rendering}`);
  if (serverAdapter) evidence.push('Astro server adapter configured');
  evidence.push(...routes.onDemandRoutes.map((route) => `on-demand route: src/pages/${route}`));
  evidence.push(...routes.staticProtocolFiles.map((file) => `static protocol file: ${file}`));
  return {
    found: true,
    rendering,
    serverAdapter,
    onDemandRoutes: routes.onDemandRoutes,
    staticProtocolFiles: routes.staticProtocolFiles,
    dynamic,
    routeConflict: await hasMcpRoute(directory),
    patchable,
    configPath,
    configSha256: hash(text),
    evidence,
  };
}

async function hasMcpRoute(directory: string): Promise<boolean> {
  for (const base of ['src/pages', 'pages', 'app']) {
    const root = path.join(directory, base);
    for (const name of [
      'mcp.astro',
      'mcp.js',
      'mcp.ts',
      'mcp.mjs',
      'mcp/index.astro',
      'mcp/index.js',
      'mcp/index.ts',
      'mcp/route.ts',
      'mcp/route.js',
    ]) {
      if (await exists(path.join(root, name))) return true;
    }
  }
  return false;
}

async function hostingEvidence(
  directory: string,
): Promise<{ hosting: InitHosting; evidence: string[]; unsupported: string[] }> {
  const found: { marker: string; host: Exclude<InitHosting, 'unknown'> }[] = [];
  for (const [marker, host] of [
    ['wrangler.toml', 'cloudflare'],
    ['wrangler.json', 'cloudflare'],
    ['wrangler.jsonc', 'cloudflare'],
    ['vercel.json', 'vercel'],
    ['netlify.toml', 'netlify'],
  ] as const) {
    if (await exists(path.join(directory, marker))) found.push({ marker, host });
  }
  const unsupported: string[] = [];
  for (const marker of ['firebase.json', 'amplify.yml', 'fly.toml', 'render.yaml']) {
    if (await exists(path.join(directory, marker))) unsupported.push(marker);
  }
  const distinct = [...new Set(found.map((item) => item.host))];
  return {
    hosting: distinct.length === 1 ? distinct[0]! : 'unknown',
    evidence: [...found.map((item) => item.marker), ...unsupported],
    unsupported,
  };
}

/** Inspect project files as data only. No configuration or application module is imported. */
export async function detectExistingProject(
  projectRoot: string,
  overrides: InitOverrides = {},
): Promise<InitDetection> {
  const root = await realpath(projectRoot);
  const rootPackage = await packageInfo(root);
  const candidates: string[] = [];
  const rootAstro = await astroEvidence(root);
  if (rootAstro.found) candidates.push(root);
  const workspaceValue = rootPackage?.['workspaces'];
  const workspacePaths = Array.isArray(workspaceValue)
    ? workspaceValue.filter((item): item is string => typeof item === 'string')
    : typeof workspaceValue === 'object' &&
        workspaceValue !== null &&
        'packages' in workspaceValue &&
        Array.isArray(workspaceValue['packages'])
      ? workspaceValue['packages'].filter((item): item is string => typeof item === 'string')
      : [];
  const hasWorkspaceLayout =
    workspacePaths.length > 0 || (await exists(path.join(root, 'pnpm-workspace.yaml')));
  if (hasWorkspaceLayout) {
    for (const group of ['apps', 'packages', 'sites']) {
      for (const child of await listDirectories(path.join(root, group))) {
        if ((await astroEvidence(child)).found && !candidates.includes(child))
          candidates.push(child);
      }
    }
  }
  const overrideRoot =
    overrides.appRoot === undefined ? null : path.resolve(root, overrides.appRoot);
  if (overrideRoot !== null && overrideRoot !== root && !overrideRoot.startsWith(root + path.sep)) {
    throw new Error('appRoot override must remain inside project root');
  }
  const overrideRealRoot = overrideRoot === null ? null : await realpath(overrideRoot);
  if (
    overrideRealRoot !== null &&
    overrideRealRoot !== root &&
    !overrideRealRoot.startsWith(root + path.sep)
  ) {
    throw new Error('appRoot override resolves through a symlink outside project root');
  }
  const applicationRoot = overrideRealRoot ?? (candidates.length === 1 ? candidates[0]! : null);
  const appRelative = applicationRoot === null ? null : path.relative(root, applicationRoot);
  const appEvidence =
    applicationRoot === null
      ? {
          found: false,
          rendering: 'unknown' as const,
          serverAdapter: false,
          onDemandRoutes: [],
          staticProtocolFiles: [],
          dynamic: false,
          routeConflict: false,
          patchable: false,
          configPath: null,
          configSha256: null,
          evidence: [],
        }
      : await astroEvidence(applicationRoot);
  const lockEvidence: string[] = [];
  for (const name of Object.keys(LOCKFILES))
    if (await exists(path.join(root, name))) lockEvidence.push(name);
  const lockManagers = [...new Set(lockEvidence.map((file) => LOCKFILES[file]!))];
  let packageManager: InitPackageManager = lockManagers.length === 1 ? lockManagers[0]! : 'unknown';
  if (overrides.packageManager) packageManager = overrides.packageManager;
  const detectedHost = await hostingEvidence(root);
  const unresolved: string[] = [];
  if (applicationRoot === null)
    unresolved.push(
      candidates.length > 1 ? 'application-root-ambiguous' : 'application-root-not-detected',
    );
  if (lockManagers.length > 1 && !overrides.packageManager) unresolved.push('competing-lockfiles');
  if (packageManager === 'unknown') unresolved.push('package-manager-unknown');
  if (appEvidence.dynamic) unresolved.push('dynamic-config-unsupported');
  else if (
    (appEvidence.rendering === 'static' || appEvidence.rendering === 'on-demand') &&
    !appEvidence.patchable
  )
    unresolved.push('astro-config-manual-integration');
  if (appEvidence.rendering === 'server' || appEvidence.rendering === 'unknown')
    unresolved.push(`rendering-${appEvidence.rendering}`);
  if (
    (appEvidence.rendering === 'on-demand' || appEvidence.rendering === 'server') &&
    !appEvidence.serverAdapter
  )
    unresolved.push('server-adapter-missing');
  if (appEvidence.staticProtocolFiles.length > 0) unresolved.push('static-protocol-endpoint');
  const framework = overrides.framework ?? (appEvidence.found ? 'astro' : 'unknown');
  if (framework === 'unknown') unresolved.push('framework-unknown');
  const host = overrides.hosting ?? detectedHost.hosting;
  if (host === 'unknown')
    unresolved.push(
      detectedHost.unsupported.length > 0 ? 'unsupported-host-config' : 'hosting-unknown',
    );
  const evidence = [
    ...(applicationRoot === null
      ? []
      : [`application root: ${appRelative || '.'}`, ...appEvidence.evidence]),
    ...lockEvidence.map((name) => `lockfile: ${name}`),
    ...detectedHost.evidence.map((name) => `hosting config: ${name}`),
  ];
  return {
    projectRoot: root,
    applicationRoot: appRelative,
    astroConfigPath: appEvidence.configPath,
    astroConfigSha256: appEvidence.configSha256,
    framework,
    rendering: appEvidence.rendering,
    serverAdapter: appEvidence.serverAdapter,
    onDemandRoutes: appEvidence.onDemandRoutes,
    staticProtocolFiles: appEvidence.staticProtocolFiles,
    packageManager,
    hosting: host,
    hostingConfig: detectedHost.evidence.length === 1 ? detectedHost.evidence[0]! : null,
    routeConflict: appEvidence.routeConflict,
    evidence,
    unresolved: [...new Set(unresolved)],
  };
}

function validateOwnedManifest(manifest: OwnedManifest): void {
  if (
    manifest.schemaVersion !== INIT_OWNERSHIP_VERSION ||
    !/^[a-f0-9]{64}$/.test(manifest.planDigest) ||
    (manifest.status !== 'applying' && manifest.status !== 'applied')
  )
    throw new Error('invalid init ownership manifest header');
  const appRoot = manifest.applicationRoot;
  if (
    appRoot !== null &&
    appRoot !== '' &&
    (path.posix.isAbsolute(appRoot) ||
      appRoot.split('/').some((part) => part === '..' || part === '.' || part === ''))
  ) {
    throw new Error('invalid application root in ownership manifest');
  }
  if (
    manifest.astroConfigPath !== null &&
    !['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'].includes(
      manifest.astroConfigPath,
    )
  ) {
    throw new Error('invalid Astro config path in ownership manifest');
  }
  const prefix = appRoot ? `${appRoot}/` : '';
  const allowed = new Set([`${prefix}${BOOTSTRAP_PATH}`, `${prefix}${SETTINGS_PATH}`]);
  if (manifest.astroConfigPath !== null) allowed.add(`${prefix}${manifest.astroConfigPath}`);
  const keys = Object.keys(manifest.files);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new Error('ownership manifest contains unexpected paths');
  }
  for (const record of Object.values(manifest.files)) {
    if (
      !/^[a-f0-9]{64}$/.test(record.afterSha256) ||
      (record.beforeSha256 !== null && !/^[a-f0-9]{64}$/.test(record.beforeSha256))
    ) {
      throw new Error('invalid file digest in ownership manifest');
    }
    if ((record.beforeSha256 !== null) !== (record.beforeContent !== undefined)) {
      throw new Error('ownership manifest must retain every overwritten preimage');
    }
    if (record.beforeContent !== undefined && hash(record.beforeContent) !== record.beforeSha256) {
      throw new Error('ownership manifest preimage does not match its digest');
    }
  }
  if (
    manifest.detection.applicationRoot !== manifest.applicationRoot ||
    manifest.detection.astroConfigPath !== manifest.astroConfigPath
  )
    throw new Error('ownership manifest detection does not match its path boundary');
  const configRelative =
    manifest.astroConfigPath === null
      ? null
      : path.posix.join(manifest.applicationRoot ?? '', manifest.astroConfigPath);
  const configRecord = configRelative === null ? null : manifest.files[configRelative];
  let patchedConfig: string | null = null;
  if (configRecord !== null) {
    if (
      configRecord === undefined ||
      configRecord.beforeContent === undefined ||
      hash(configRecord.beforeContent) !== manifest.detection.astroConfigSha256
    ) {
      throw new Error('ownership manifest lacks the original Astro config preimage');
    }
    patchedConfig = patchAstroConfig(configRecord.beforeContent);
  }
  const expected = makeScaffold(manifest.selectedChoices, manifest.detection, patchedConfig);
  if (Object.keys(expected).length !== Object.keys(manifest.files).length) {
    throw new Error('ownership manifest file set does not match generated output');
  }
  for (const [relativePath, content] of Object.entries(expected)) {
    if (manifest.files[relativePath]?.afterSha256 !== hash(content)) {
      throw new Error(
        `ownership manifest output digest does not match generated file: ${relativePath}`,
      );
    }
  }
}

export async function createInitPlan(
  projectRoot: string,
  overrides: InitOverrides = {},
  selectedChoices: InitChoices | null = null,
): Promise<InitPlan> {
  const detection = await detectExistingProject(projectRoot, overrides);
  const appPrefix = detection.applicationRoot ? `${detection.applicationRoot}/` : '';
  const ownershipText = await readOptional(detection.projectRoot, MANIFEST_PATH);
  let alreadyInitialized = false;
  if (ownershipText !== null) {
    const ownership = JSON.parse(ownershipText) as OwnedManifest;
    validateOwnedManifest(ownership);
    alreadyInitialized =
      ownership.schemaVersion === INIT_OWNERSHIP_VERSION && ownership.status === 'applied';
    for (const [relativePath, record] of Object.entries(ownership.files)) {
      const current = await readOptional(detection.projectRoot, relativePath);
      if (current === null || hash(current) !== record.afterSha256) alreadyInitialized = false;
    }
  }
  const proposedFiles = alreadyInitialized
    ? []
    : [
        `${appPrefix}${BOOTSTRAP_PATH}`,
        `${appPrefix}${SETTINGS_PATH}`,
        ...(detection.astroConfigPath ? [`${appPrefix}${detection.astroConfigPath}`] : []),
        MANIFEST_PATH,
      ];
  const payload = {
    schemaVersion: INIT_PLAN_VERSION as typeof INIT_PLAN_VERSION,
    detection,
    proposedFiles,
    dependencyChanges: alreadyInitialized
      ? []
      : [
          {
            name: '@uppercut-labs/agent-native',
            action: 'add-after-release' as const,
            reason: 'The package is currently private and has no installable public release.',
          },
        ],
    manualIntegration:
      alreadyInitialized ||
      detection.framework !== 'astro' ||
      detection.rendering !== 'static' ||
      detection.unresolved.includes('astro-config-manual-integration')
        ? 'Review Astro config manually; this init does not rewrite unsupported config shapes.'
        : 'Astro config will be patched only from the recognized literal static template; review the generated diff before approval.',
    alreadyInitialized,
    selectedChoices,
    detectionOverrides: overrides,
  };
  return { ...payload, planDigest: hash(stableJson(payload)) };
}

function patchAstroConfig(source: string): string {
  const supported =
    /^import\s+\{\s*defineConfig\s*\}\s+from\s+(['"])astro\/config\1;\s*export\s+default\s+defineConfig\s*\(\s*\{\s*output\s*:\s*(['"])static\2\s*,?\s*\}\s*\);\s*$/s;
  if (!supported.test(source))
    throw new Error(
      'Astro config is not the supported literal static shape; review the integration plan manually',
    );
  if (source.includes('@uppercut-labs/agent-native/astro'))
    throw new Error(
      'Astro config already references Agent Native; inspect existing integration before init',
    );
  return `import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { agentNativeAstro } from '@uppercut-labs/agent-native/astro';

export default defineConfig({
  output: 'static',
  integrations: [
    agentNativeAstro({
      browserEntry: fileURLToPath(new URL('./.agent-native/browser-entry.mjs', import.meta.url)),
    }),
  ],
});
`;
}

function makeScaffold(
  choices: InitChoices,
  detection: InitDetection,
  astroConfig: string | null,
): Scaffold {
  const appPrefix = detection.applicationRoot ? `${detection.applicationRoot}/` : '';
  const bootstrapPath = `${appPrefix}${BOOTSTRAP_PATH}`;
  const settingsPath = `${appPrefix}${SETTINGS_PATH}`;
  const settings = {
    schemaVersion: 'uan.init-settings/v1',
    framework: detection.framework,
    rendering: detection.rendering,
    applicationRoot: detection.applicationRoot,
    packageManager: detection.packageManager,
    hosting: choices.hosting,
    sidecarOrigin: choices.sidecarOrigin ?? null,
    routeMode: choices.routeMode ?? 'sidecar',
    browserEntry: bootstrapPath,
    note: 'No application exports or handlers were discovered or registered. Add only explicitly reviewed definitions and bindings in application-owned code.',
  };
  return {
    [bootstrapPath]: `// Tool-owned browser bootstrap. No project exports are discovered or registered.\nconst sidecarOrigin = ${JSON.stringify(choices.sidecarOrigin ?? null)};\ndocument.documentElement.dataset.agentNative = 'ready';\ndocument.dispatchEvent(new CustomEvent('agent-native:ready', { detail: { sidecarOrigin } }));\n`,
    [settingsPath]: `${JSON.stringify(settings, null, 2)}\n`,
    ...(astroConfig === null ||
    detection.applicationRoot === null ||
    detection.astroConfigPath === null
      ? {}
      : { [`${appPrefix}${detection.astroConfigPath}`]: astroConfig }),
  };
}

async function writeAtomic(destination: string, content: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeNewNoReplace(destination: string, content: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function replaceIfUnchanged(
  destination: string,
  content: string,
  expectedSha256: string,
): Promise<void> {
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    const current = await readFile(destination);
    if (hash(current) !== expectedSha256)
      throw new Error(`target changed before guarded replacement: ${destination}`);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function applyScaffoldFiles(
  root: string,
  scaffold: Scaffold,
  records: OwnedManifest['files'],
  beforeTargetWrite?: (relativePath: string) => Promise<void>,
  failAfterWrites?: number,
): Promise<number> {
  let writes = 0;
  for (const [relativePath, content] of Object.entries(scaffold)) {
    await beforeTargetWrite?.(relativePath);
    const target = await assertNoSymlink(root, relativePath);
    const record = records[relativePath];
    if (record === undefined)
      throw new Error(`ownership manifest is missing record: ${relativePath}`);
    const current = await readOptional(root, relativePath);
    if (current !== null && hash(current) === record.afterSha256) continue;
    if (record.beforeSha256 === null) {
      if (current !== null)
        throw new Error(`refusing to replace a file created after plan: ${relativePath}`);
      await writeNewNoReplace(target, content);
    } else {
      if (current === null || hash(current) !== record.beforeSha256) {
        throw new Error(`refusing to replace a file changed after plan: ${relativePath}`);
      }
      await replaceIfUnchanged(target, content, record.beforeSha256);
    }
    writes += 1;
    if (failAfterWrites === writes) throw new Error('simulated interrupted init');
  }
  return writes;
}

export async function applyInitPlan(
  projectRoot: string,
  plan: InitPlan,
  choices: InitChoices,
  options: {
    readonly approved: boolean;
    readonly failAfterWrites?: number;
    readonly beforeTargetWrite?: (relativePath: string) => Promise<void>;
  },
): Promise<InitApplyResult> {
  if (!options.approved) throw new Error('plan must be explicitly approved');
  if (plan.selectedChoices === null || stableJson(plan.selectedChoices) !== stableJson(choices))
    throw new Error('apply choices must exactly match the reviewed plan');
  const root = await realpath(projectRoot);
  if (root !== plan.detection.projectRoot)
    throw new Error('plan project root does not match apply root');
  const planPayload = { ...plan } as Record<string, unknown>;
  delete planPayload['planDigest'];
  if (hash(stableJson(planPayload)) !== plan.planDigest)
    throw new Error('init plan digest is invalid');

  const manifestTarget = await assertNoSymlink(root, MANIFEST_PATH);
  const existingManifestText = await readOptional(root, MANIFEST_PATH);
  let existingManifest: OwnedManifest | null = null;
  if (!plan.alreadyInitialized && existingManifestText !== null) {
    existingManifest = JSON.parse(existingManifestText) as OwnedManifest;
    validateOwnedManifest(existingManifest);
    if (
      existingManifest.planDigest !== plan.planDigest ||
      existingManifest.applicationRoot !== plan.detection.applicationRoot ||
      existingManifest.astroConfigPath !== plan.detection.astroConfigPath ||
      stableJson(existingManifest.detection) !== stableJson(plan.detection) ||
      stableJson(existingManifest.selectedChoices) !== stableJson(choices)
    )
      throw new Error('existing init ownership manifest does not match this plan');
    for (const [relativePath, record] of Object.entries(existingManifest.files)) {
      const current = await readOptional(root, relativePath);
      if (current === null) {
        if (record.beforeSha256 !== null || existingManifest.status !== 'applying')
          throw new Error('owned file disappeared after interruption: ' + relativePath);
      } else if (
        hash(current) !== record.afterSha256 &&
        (record.beforeSha256 === null || hash(current) !== record.beforeSha256)
      ) {
        throw new Error('owned file changed after interruption: ' + relativePath);
      }
    }
  }
  const currentDetection = await detectExistingProject(root, plan.detectionOverrides);
  let resumableDetection = currentDetection;
  if (existingManifest?.status === 'applying' && existingManifest.astroConfigPath !== null) {
    const configPath = path.posix.join(
      existingManifest.applicationRoot ?? '',
      existingManifest.astroConfigPath,
    );
    const configRecord = existingManifest.files[configPath];
    const currentConfig = await readOptional(root, configPath);
    if (
      configRecord !== undefined &&
      currentConfig !== null &&
      hash(currentConfig) === configRecord.afterSha256
    ) {
      resumableDetection = {
        ...currentDetection,
        astroConfigSha256: plan.detection.astroConfigSha256,
        unresolved: currentDetection.unresolved.filter(
          (item) =>
            item !== 'astro-config-manual-integration' || plan.detection.unresolved.includes(item),
        ),
      };
    }
  }
  if (stableJson(resumableDetection) !== stableJson(plan.detection))
    throw new Error('project evidence changed after plan creation; create a fresh plan');
  if (plan.alreadyInitialized) {
    const ownedText = await readOptional(root, MANIFEST_PATH);
    if (ownedText === null) throw new Error('ownership manifest disappeared after no-op plan');
    const owned = JSON.parse(ownedText) as OwnedManifest;
    validateOwnedManifest(owned);
    for (const [relativePath, record] of Object.entries(owned.files)) {
      const current = await readOptional(root, relativePath);
      if (current === null || hash(current) !== record.afterSha256)
        throw new Error(`owned file changed after plan: ${relativePath}`);
    }
    return { status: 'no-op', ownedFiles: Object.keys(owned.files), planDigest: plan.planDigest };
  }
  const unresolved = plan.detection.unresolved.filter((item) => item !== 'hosting-unknown');
  if (unresolved.length > 0)
    throw new Error(`plan has unresolved detection: ${unresolved.join(', ')}`);
  if (choices.hosting !== 'browser-only' && choices.sidecarOrigin === undefined)
    throw new Error('a selected sidecar host requires an explicit sidecarOrigin');
  if (choices.routeMode === 'same-origin' && plan.detection.rendering === 'static')
    throw new Error(
      'same-origin mode requires reviewed on-demand routes and a server adapter; choose sidecar for a static site',
    );
  if (choices.sidecarOrigin !== undefined) {
    const parsed = new URL(choices.sidecarOrigin);
    if (
      parsed.protocol !== 'https:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    )
      throw new Error('sidecarOrigin must use HTTPS except on localhost');
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error('sidecarOrigin must not contain credentials, query, or fragment');
  }
  if (plan.detection.routeConflict && choices.routeMode === 'same-origin')
    throw new Error('an existing /mcp route conflicts with same-origin mode');
  const configRelative =
    plan.detection.astroConfigPath !== null && plan.detection.applicationRoot !== null
      ? path.posix.join(plan.detection.applicationRoot, plan.detection.astroConfigPath)
      : null;
  let originalConfig: string | null = null;
  if (configRelative !== null) {
    const currentConfig = await readOptional(root, configRelative);
    const configRecord = existingManifest?.files[configRelative];
    if (existingManifest?.status === 'applying' && configRecord !== undefined) {
      if (
        currentConfig === null ||
        (hash(currentConfig) !== configRecord.beforeSha256 &&
          hash(currentConfig) !== configRecord.afterSha256)
      )
        throw new Error('Astro config changed after interrupted init');
      originalConfig = configRecord.beforeContent ?? null;
    } else {
      if (currentConfig === null || hash(currentConfig) !== plan.detection.astroConfigSha256)
        throw new Error('Astro config changed after plan creation');
      originalConfig = currentConfig;
    }
  }
  const patchedConfig = originalConfig === null ? null : patchAstroConfig(originalConfig);
  const scaffold = makeScaffold(choices, plan.detection, patchedConfig);
  if (existingManifest !== null && existingManifestText !== null) {
    const existing = existingManifest;
    for (const [relativePath, record] of Object.entries(existing.files)) {
      const current = await readOptional(root, relativePath);
      const expected = scaffold[relativePath];
      if (expected === undefined || hash(expected) !== record.afterSha256)
        throw new Error(`init choices differ from recorded plan: ${relativePath}`);
      if (
        current !== null &&
        hash(current) !== record.afterSha256 &&
        hash(current) !== record.beforeSha256
      )
        throw new Error(`owned file changed after interruption: ${relativePath}`);
      if (current === null && record.beforeSha256 !== null)
        throw new Error(`owned file disappeared after interruption: ${relativePath}`);
      if (current === null && existing.status === 'applied')
        throw new Error(`owned file disappeared after init: ${relativePath}`);
    }
    if (existing.status === 'applied')
      return {
        status: 'no-op',
        ownedFiles: Object.keys(existing.files),
        planDigest: plan.planDigest,
      };
    await applyScaffoldFiles(
      root,
      scaffold,
      existing.files,
      options.beforeTargetWrite,
      options.failAfterWrites,
    );
    const complete: OwnedManifest = { ...existing, status: 'applied' };
    await replaceIfUnchanged(
      manifestTarget,
      `${JSON.stringify(complete, null, 2)}\n`,
      hash(existingManifestText),
    );
    return {
      status: 'applied',
      ownedFiles: Object.keys(existing.files),
      planDigest: plan.planDigest,
    };
  }
  const records: Record<
    string,
    { beforeSha256: string | null; afterSha256: string; beforeContent?: string }
  > = {};
  for (const [relativePath, content] of Object.entries(scaffold)) {
    await assertNoSymlink(root, relativePath);
    const current = await readOptional(root, relativePath);
    const isConfig = relativePath.endsWith(plan.detection.astroConfigPath ?? '\u0000');
    if (current !== null && !isConfig)
      throw new Error(`refusing to overwrite existing file: ${relativePath}`);
    if (isConfig && (current === null || hash(current) !== plan.detection.astroConfigSha256))
      throw new Error(`Astro config changed after plan creation: ${relativePath}`);
    records[relativePath] = {
      beforeSha256: current === null ? null : hash(current),
      afterSha256: hash(content),
      ...(current === null ? {} : { beforeContent: current }),
    };
  }
  const manifest: OwnedManifest = {
    schemaVersion: INIT_OWNERSHIP_VERSION,
    planDigest: plan.planDigest,
    status: 'applying',
    applicationRoot: plan.detection.applicationRoot,
    astroConfigPath: plan.detection.astroConfigPath,
    detection: plan.detection,
    selectedChoices: choices,
    files: records,
  };
  await writeNewNoReplace(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`);
  await applyScaffoldFiles(
    root,
    scaffold,
    records,
    options.beforeTargetWrite,
    options.failAfterWrites,
  );
  const complete: OwnedManifest = { ...manifest, status: 'applied' };
  await replaceIfUnchanged(
    manifestTarget,
    `${JSON.stringify(complete, null, 2)}\n`,
    hash(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  return { status: 'applied', ownedFiles: Object.keys(records), planDigest: plan.planDigest };
}

export async function restoreInit(
  projectRoot: string,
  options: { readonly beforeTargetRestore?: (relativePath: string) => Promise<void> } = {},
): Promise<InitRestoreResult> {
  const root = await realpath(projectRoot);
  const manifestText = await readOptional(root, MANIFEST_PATH);
  if (manifestText === null) return { status: 'no-op', removed: [], conflicts: [] };
  const manifest = JSON.parse(manifestText) as OwnedManifest;
  validateOwnedManifest(manifest);
  const conflicts: string[] = [];
  const removable: string[] = [];
  for (const [relativePath, record] of Object.entries(manifest.files)) {
    const current = await readOptional(root, relativePath);
    if (current !== null && hash(current) === record.afterSha256) removable.push(relativePath);
    else if (
      current !== null &&
      record.beforeSha256 !== null &&
      hash(current) === record.beforeSha256
    )
      continue;
    else if (current === null && record.beforeSha256 === null) continue;
    else conflicts.push(relativePath);
  }
  if (conflicts.length > 0) return { status: 'conflict', removed: [], conflicts };
  for (const relativePath of removable) {
    const record = manifest.files[relativePath]!;
    await options.beforeTargetRestore?.(relativePath);
    const current = await readOptional(root, relativePath);
    if (current === null || hash(current) !== record.afterSha256) {
      return { status: 'conflict', removed: [], conflicts: [relativePath] };
    }
    const target = await assertNoSymlink(root, relativePath);
    if (record.beforeContent === undefined) await rm(target);
    else await replaceIfUnchanged(target, record.beforeContent, record.afterSha256);
  }
  await rm(await assertNoSymlink(root, MANIFEST_PATH));
  for (const directory of ['.agent-native']) {
    const target = path.join(root, directory);
    try {
      await rmdir(target);
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOTEMPTY'
      )
        throw error;
    }
  }
  return { status: 'restored', removed: removable, conflicts: [] };
}
