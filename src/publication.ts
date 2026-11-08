// Experimental, portable publication API. Planning never writes files or sends requests.
export interface PublicationConfig {
  readonly enabled: boolean;
  readonly siteUrl: string;
  readonly title: string;
  readonly description: string;
  readonly full?: boolean;
  readonly maxFullBytes?: number;
  /** Site-relative paths. Each exclusion includes all descendants. */
  readonly excludedRoutes?: readonly string[];
  readonly protocols?: readonly PublicationProtocol[];
}

export interface PublicationProtocol {
  readonly url: string;
  readonly protocol: string;
  readonly required?: boolean;
}

/** An owner-declared labeled value, published beside the prose that states it. */
export interface PublicationFact {
  readonly label: string;
  readonly value: string;
}

export interface PublicationCandidate {
  /** Stable opaque identifiers. Source paths and credentials do not belong here. */
  readonly id: string;
  readonly revision: string;
  readonly route: string;
  readonly visibility:
    | 'public'
    | 'private'
    | 'draft'
    | 'authenticated'
    | 'personalized'
    | 'unknown';
  /** Only fields explicitly selected for the public projection. */
  readonly title?: string;
  readonly markdown?: string;
  readonly locale?: string;
  readonly category?: string;
  readonly structuredType?: 'WebPage' | 'Article';
  /** Links to other selected sources. Withdrawal automatically removes the link. */
  readonly links?: readonly string[];
  /** Labeled values restated from the prose, rendered as a "Key facts" list in the mirror. */
  readonly facts?: readonly PublicationFact[];
}

export interface PublicationEntry {
  readonly sourceId: string;
  readonly revision: string;
  readonly status: 'included' | 'excluded';
  readonly reason?: string;
  readonly canonical?: string;
  readonly mirror?: string;
  readonly structuredData?: string;
  readonly locale?: string;
}

export interface PublicationAsset {
  readonly path: string;
  readonly mediaType: string;
  readonly content: string;
  readonly digest: string;
}

export interface PublicationDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly sourceId?: string;
}

export interface PublicationPlan {
  readonly schemaVersion: 1;
  readonly digest: string;
  readonly manifest: { readonly entries: readonly PublicationEntry[] };
  readonly assets: readonly PublicationAsset[];
  readonly diagnostics: readonly PublicationDiagnostic[];
}

export interface PublicationOptions {
  /** Owner-supplied read-only verifier. JSON configuration cannot attest to its own endpoint. */
  readonly verifyProtocol?: (declaration: PublicationProtocol) => Promise<boolean>;
}

const encoder = new TextEncoder();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function digestText(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** A relative path safe across supported filesystems, before checking for symlinks/ownership. */
export function safePublicationPath(path: string): boolean {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.normalize('NFC') === path &&
    path
      .split('/')
      .every(
        (segment) =>
          /^[\p{L}\p{N}_~-][\p{L}\p{M}\p{N}._~-]*$/u.test(segment) &&
          encoder.encode(segment).length <= 255 &&
          !segment.endsWith('.') &&
          !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment),
      )
  );
}

function validRoute(route: string): boolean {
  return (
    route === '/' ||
    (typeof route === 'string' &&
      route.startsWith('/') &&
      safePublicationPath(route.slice(1).replace(/\/$/, '')))
  );
}

function siteRoot(raw: string): URL | null {
  // Check the raw path before URL normalizes dot segments and backslashes.
  const match = typeof raw === 'string' && /^https?:\/\/([^/?#\\\s]+)(\/[^?#\\\s]*)?$/iu.exec(raw);
  if (!match || !validRoute(match[2] ?? '/') || match[1]?.includes('@')) return null;
  try {
    return new URL(raw.endsWith('/') ? raw : `${raw}/`);
  } catch {
    return null;
  }
}

function opaque(id: unknown): id is string {
  return typeof id === 'string' && /^[\w][\w.:-]{0,127}$/.test(id);
}

function plain(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n<>]/.test(value);
}

const maxFacts = 20;
// Raw HTML, URI destinations and reference syntax bypass the projected target allowlist.
const unreviewedMarkup = /<\/?[a-z!]|\]\s*(?:\(|\[|:)|(?:[a-z][a-z0-9+.-]*:\/\/)|<[^>]+@[^>]+>/i;

function validFacts(facts: unknown): facts is readonly PublicationFact[] {
  return (
    Array.isArray(facts) &&
    facts.length <= maxFacts &&
    facts.every(
      (fact) =>
        fact !== null &&
        typeof fact === 'object' &&
        plain(fact.label) &&
        plain(fact.value) &&
        fact.label.length <= 120 &&
        fact.value.length <= 500 &&
        !unreviewedMarkup.test(`${fact.label}\n${fact.value}`),
    )
  );
}

function escapeLabel(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+!|~]/g, '\\$&');
}

function routeKey(route: string): string {
  return route.toLowerCase().replace(/\/$/, '') || '/';
}

function within(route: string, prefix: string): boolean {
  return prefix === '/' || route === prefix || route.startsWith(`${prefix}/`);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

interface Page {
  source: PublicationCandidate;
  title: string;
  body: string;
  group: string;
  stem: string;
  canonical: string;
  mirror: string;
}

export async function planPublication(
  config: PublicationConfig,
  candidates: readonly PublicationCandidate[],
  options: PublicationOptions = {},
): Promise<PublicationPlan> {
  const diagnostics: PublicationDiagnostic[] = [];
  const report = (
    code: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
    sourceId?: string,
  ) => diagnostics.push({ code, severity, message, ...(opaque(sourceId) ? { sourceId } : {}) });
  const entries: PublicationEntry[] = [];
  const emitted: Omit<PublicationAsset, 'digest'>[] = [];
  const pages: Page[] = [];
  const base = siteRoot(config?.siteUrl);
  const exclusions = config?.excludedRoutes ?? [];
  const declarations = config?.protocols ?? [];
  const max = config?.maxFullBytes ?? 1_048_576;
  if (
    !base ||
    !plain(config?.title) ||
    !plain(config?.description) ||
    typeof config?.enabled !== 'boolean' ||
    (config.full !== undefined && typeof config.full !== 'boolean') ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    !Array.isArray(exclusions) ||
    !exclusions.every(validRoute) ||
    !Array.isArray(declarations) ||
    !Array.isArray(candidates)
  ) {
    report(
      'invalid-config',
      'Provide a valid site root, title, description, explicit enabled flag and publication settings.',
    );
  }

  const scope: unknown[] = [];
  const seenIds = new Set<string>();
  const routes = new Set<string>();
  const restrictedRoutes: string[] = [];
  const reserved = ['/llms.txt', '/llms-full.txt', '/agent-native'];
  if (base && diagnostics.length === 0) {
    const excluded = exclusions.map(routeKey);
    for (const candidate of [...candidates].sort((a, b) => compare(String(a?.id), String(b?.id)))) {
      if (!opaque(candidate?.id) || !opaque(candidate?.revision) || seenIds.has(candidate.id)) {
        report(
          'invalid-source',
          'Provide unique opaque source IDs and nonempty opaque revision IDs.',
        );
        continue;
      }
      const { id, revision, route, visibility } = candidate;
      seenIds.add(id);
      const metadata = { sourceId: id, revision };
      const valid = validRoute(route);
      const key = valid ? routeKey(route) : '';
      scope.push([id, revision, typeof route === 'string' ? route : null, visibility]);
      if (config.enabled && valid) {
        if (reserved.some((prefix) => within(key, prefix))) {
          report(
            'reserved-route',
            'An application route overlaps the publication namespace.',
            'error',
            id,
          );
        }
        if (routes.has(key))
          report(
            'route-collision',
            'Multiple sources claim the same normalized route.',
            'error',
            id,
          );
        routes.add(key);
      }
      const reason = !config.enabled
        ? 'disabled'
        : visibility !== 'public'
          ? 'visibility'
          : excluded.some((prefix) => within(key, prefix))
            ? 'excluded-route'
            : undefined;
      if (reason) {
        if (valid) restrictedRoutes.push(key);
        entries.push({ ...metadata, status: 'excluded', reason });
        if (reason === 'visibility' && visibility === 'unknown') {
          report(
            'review-visibility',
            'Confirm public visibility before selecting this source.',
            'warning',
            id,
          );
        }
        continue;
      }
      if (!valid) {
        report(
          'unsafe-route',
          'Provide a concrete site-relative route without aliases, traversal, query parameters or dynamic placeholders.',
          'error',
          id,
        );
        continue;
      }
      const { title, markdown, category, locale, structuredType, links, facts } = candidate;
      if (
        !plain(title) ||
        typeof markdown !== 'string' ||
        !markdown.trim() ||
        (category !== undefined && !plain(category)) ||
        (locale !== undefined &&
          (typeof locale !== 'string' || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(locale))) ||
        (structuredType !== undefined &&
          structuredType !== 'WebPage' &&
          structuredType !== 'Article') ||
        (links !== undefined && (!Array.isArray(links) || !links.every(opaque))) ||
        (facts !== undefined && !validFacts(facts))
      ) {
        report(
          'invalid-projection',
          'Select a public title and body; check locale, links and structured type.',
          'error',
          id,
        );
        continue;
      }
      if (unreviewedMarkup.test(markdown)) {
        report(
          'unreviewed-markup',
          'Use Markdown prose and headings. Declare navigable links by public source ID.',
          'error',
          id,
        );
        continue;
      }
      scope.push([
        id,
        category ?? null,
        locale ?? null,
        structuredType ?? null,
        [...new Set(links ?? [])].sort(compare),
        (facts ?? []).map(({ label, value }) => [label, value]),
      ]);
      const stem = `agent-native/${route.slice(1).replace(/\/$/, '') || 'index'}`;
      const canonical = new URL(route.slice(1), base).href;
      const mirror = new URL(`${stem}.md`, base).href;
      entries.push({
        ...metadata,
        status: 'included',
        canonical,
        mirror,
        ...(locale ? { locale } : {}),
        ...(structuredType ? { structuredData: new URL(`${stem}.jsonld`, base).href } : {}),
      });
      pages.push({
        source: candidate,
        title,
        body: markdown.replace(/\r\n?/g, '\n').trim(),
        group: category ?? 'Pages',
        stem,
        canonical,
        mirror,
      });
    }
  }

  const verified: string[] = [];
  if (config?.enabled === true && base && !diagnostics.some((d) => d.severity === 'error')) {
    for (const declaration of declarations) {
      let url: URL | undefined;
      try {
        url = new URL(declaration?.url);
      } catch {
        /* Invalid declarations are reported below. */
      }
      const permitted =
        url &&
        url.origin === base.origin &&
        url.pathname.startsWith(base.pathname) &&
        url.href === declaration.url &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        validRoute(url.pathname.replace('/.well-known/', '/well-known/')) &&
        opaque(declaration.protocol) &&
        ![...restrictedRoutes, ...exclusions.map(routeKey)].some((prefix) =>
          within(routeKey(`/${url.pathname.slice(base.pathname.length)}`), prefix),
        );
      let passed = false;
      if (permitted && url && options.verifyProtocol) {
        try {
          passed =
            (await options.verifyProtocol({ url: url.href, protocol: declaration.protocol })) ===
            true;
        } catch {
          /* Unavailable verification cannot advertise a service. */
        }
      }
      if (passed && url) verified.push(`- [${escapeLabel(declaration.protocol)}](${url.href})`);
      else
        report(
          'unverified-protocol',
          'Supply a public same-site endpoint and matching live protocol verification.',
          declaration?.required ? 'error' : 'warning',
        );
    }

    const add = (path: string, mediaType: string, content: string) =>
      emitted.push({ path, mediaType, content });
    const mirrors: string[] = [];
    const byId = new Map(pages.map((page) => [page.source.id, page]));
    const groups = new Map<string, string[]>();
    pages.sort((a, b) => compare(a.canonical, b.canonical));
    for (const page of pages) {
      const { source, canonical, mirror, stem, title, body, group } = page;
      const links: string[] = [];
      for (const targetId of [...new Set(source.links ?? [])].sort(compare)) {
        const target = byId.get(targetId);
        if (target) links.push(`- [${escapeLabel(target.title)}](${target.canonical})`);
        else
          report(
            'excluded-link',
            'A linked source is unavailable or outside the public projection.',
            'warning',
            source.id,
          );
      }
      const facts = (source.facts ?? []).map(
        ({ label, value }) => `- ${escapeLabel(label)}: ${escapeLabel(value)}`,
      );
      // The mirror names its own URL, so an agent that reached it through content negotiation
      // or the aggregate can cite either representation explicitly.
      const markdown = `# ${escapeLabel(title)}\n\nCanonical: <${canonical}>\nMarkdown: <${mirror}>\n${source.locale ? `\nLanguage: ${source.locale}\n` : ''}\n${body}\n${facts.length ? `\n## Key facts\n\n${facts.join('\n')}\n` : ''}${links.length ? `\n## Related pages\n\n${links.join('\n')}\n` : ''}`;
      add(`${stem}.md`, 'text/markdown', markdown);
      mirrors.push(markdown);
      if (source.structuredType) {
        const json = {
          '@context': 'https://schema.org',
          '@type': source.structuredType,
          '@id': canonical,
          url: canonical,
          [source.structuredType === 'Article' ? 'headline' : 'name']: title,
          ...(source.locale ? { inLanguage: source.locale } : {}),
        };
        add(`${stem}.jsonld`, 'application/ld+json', `${safeJson(json)}\n`);
      }
      const listing = groups.get(group) ?? [];
      listing.push(`- [${escapeLabel(title)}](${mirror})`);
      groups.set(group, listing);
    }
    const sections = [...groups.keys()]
      .sort(compare)
      .map((group) => `## ${escapeLabel(group)}\n\n${groups.get(group)?.join('\n')}`);
    if (verified.length)
      sections.push(`## Public protocols\n\n${[...new Set(verified)].sort(compare).join('\n')}`);
    const heading = `# ${escapeLabel(config.title)}\n\n> ${escapeLabel(config.description)}\n`;
    const full = config.full ? [heading, ...mirrors].join('\n') : undefined;
    const fullFits = full !== undefined && encoder.encode(full).length <= max;
    if (full !== undefined && !fullFits)
      report(
        'aggregate-too-large',
        'Reduce the selected content or approve a larger aggregate byte limit.',
      );
    // The index lists the whole approved projection, so it can state its own coverage. An agent
    // can then decline an unpublished fact without crawling every page first.
    const coverage =
      `This index lists every page this site publishes (${pages.length} ${pages.length === 1 ? 'page' : 'pages'}). ` +
      'A fact that is not stated on these pages is not published by this site. ' +
      'Private, draft, authenticated and personalized records are never published here.\n' +
      (fullFits
        ? `\n- [All published pages in one file](${new URL('llms-full.txt', base).href})\n`
        : '');
    add('llms.txt', 'text/plain', `${[heading, coverage, ...sections].join('\n').trimEnd()}\n`);
    if (full !== undefined && fullFits) add('llms-full.txt', 'text/plain', full);
    const paths = new Set<string>();
    for (const asset of emitted) {
      if (!safePublicationPath(asset.path))
        report('unsafe-output', 'The output path exceeds the portable filename limits.');
      const key = asset.path.toLowerCase();
      if (paths.has(key))
        report('output-collision', 'Multiple projections require the same output file.');
      paths.add(key);
    }
    for (const path of paths) {
      let parent = path;
      while (parent.includes('/')) {
        parent = parent.slice(0, parent.lastIndexOf('/'));
        if (paths.has(parent))
          report('output-collision', 'An output file would also need to be a directory.');
      }
    }
  }
  const blocked = diagnostics.some((d) => d.severity === 'error');
  const assets = await Promise.all(
    (blocked ? [] : emitted)
      .sort((a, b) => compare(a.path, b.path))
      .map(async (asset) => ({ ...asset, digest: await digestText(asset.content) })),
  );
  diagnostics.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const identity = [
    1,
    base?.href ?? '',
    config?.enabled,
    config?.title,
    config?.description,
    config?.full ?? false,
    max,
    Array.isArray(exclusions) ? [...exclusions].sort(compare) : [],
    Array.isArray(declarations)
      ? declarations
          .map((d) => JSON.stringify([d?.protocol, d?.url, d?.required ?? false]))
          .sort(compare)
      : [],
    scope,
    entries,
    assets.map(({ path, mediaType, digest }) => [path, mediaType, digest]),
    diagnostics,
  ];
  return {
    schemaVersion: 1,
    digest: await digestText(JSON.stringify(identity)),
    manifest: { entries },
    assets,
    diagnostics,
  };
}

// Markdown content negotiation. A client that names text/markdown in Accept (agents and
// retrieval tools; browsers never do) receives the approved mirror at the canonical URL.

function quality(params: readonly string[]): number {
  for (const param of params) {
    const match = /^q\s*=\s*([01](?:\.\d{0,3})?)$/.exec(param);
    if (match) return Number(match[1]);
  }
  return 1;
}

/** True when Accept names text/markdown with q > 0 and no lower than the q that admits HTML. */
export function acceptsMarkdown(accept: string | null | undefined): boolean {
  if (typeof accept !== 'string' || !accept.trim()) return false;
  let markdown = -1;
  let html = -1;
  let textAny = -1;
  let any = -1;
  for (const part of accept.split(',')) {
    const [type = '', ...params] = part.split(';').map((item) => item.trim().toLowerCase());
    const q = quality(params);
    if (type === 'text/markdown') markdown = Math.max(markdown, q);
    else if (type === 'text/html') html = Math.max(html, q);
    else if (type === 'text/*') textAny = Math.max(textAny, q);
    else if (type === '*/*') any = Math.max(any, q);
  }
  const htmlQuality = html >= 0 ? html : textAny >= 0 ? textAny : Math.max(any, 0);
  return markdown > 0 && markdown >= htmlQuality;
}

function pathKey(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname).normalize('NFC');
  } catch {
    return undefined;
  }
  return decoded.length > 1 ? decoded.replace(/\/$/, '') : decoded;
}

/** Canonical path to mirror path for every published page, from plan entries or projection pages. */
export function markdownMirrors(
  pages: readonly { readonly canonical?: string; readonly mirror?: string | null }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const page of pages) {
    if (!page?.canonical || !page.mirror) continue;
    const key = pathKey(new URL(page.canonical).pathname);
    if (key !== undefined) map[key] = new URL(page.mirror).pathname;
  }
  return map;
}

export interface MarkdownNegotiation {
  /** Path of the mirror to serve in place of the HTML page, or null to serve the page. */
  readonly mirror: string | null;
  /** The response depends on Accept: send `Vary: Accept` whichever representation is served. */
  readonly vary: boolean;
}

export function negotiateMarkdown(
  request: {
    readonly method?: string | undefined;
    readonly pathname: string;
    readonly accept?: string | null | undefined;
  },
  mirrors: Readonly<Record<string, string>>,
): MarkdownNegotiation {
  const method = (request.method ?? 'GET').toUpperCase();
  const key = pathKey(request.pathname);
  const target = key !== undefined && Object.hasOwn(mirrors, key) ? mirrors[key] : undefined;
  if (!target || (method !== 'GET' && method !== 'HEAD')) return { mirror: null, vary: false };
  return { mirror: acceptsMarkdown(request.accept) ? target : null, vary: true };
}

/** Adds a token to a Vary header value without duplicating it. */
export function addVary(current: unknown, token = 'Accept'): string {
  const values = (Array.isArray(current) ? current.join(',') : String(current ?? ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.includes('*') || values.some((value) => value.toLowerCase() === token.toLowerCase()))
    return values.join(', ');
  return [...values, token].join(', ');
}

interface NodeLikeRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

interface NodeLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  getHeader(name: string): unknown;
  end(body?: string | Uint8Array): unknown;
}

/**
 * Node `(req, res, next)` middleware. `read` returns the mirror bytes for a mirror path (for
 * example from the generated asset directory) or null when it is unavailable.
 */
export function markdownNegotiationHandler(
  mirrors: Readonly<Record<string, string>>,
  read: (mirrorPath: string) => Promise<string | Uint8Array | null | undefined>,
) {
  return (req: NodeLikeRequest, res: NodeLikeResponse, next: (error?: unknown) => void): void => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      next();
      return;
    }
    const accept = req.headers['accept'];
    const decision = negotiateMarkdown(
      {
        method: req.method,
        pathname,
        accept: Array.isArray(accept) ? accept.join(',') : (accept as string | undefined),
      },
      mirrors,
    );
    if (decision.vary) res.setHeader('Vary', addVary(res.getHeader('vary')));
    if (!decision.mirror) {
      next();
      return;
    }
    read(decision.mirror).then(
      (body) => {
        if (body === null || body === undefined) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.end(req.method?.toUpperCase() === 'HEAD' ? undefined : body);
      },
      (error) => next(error),
    );
  };
}
