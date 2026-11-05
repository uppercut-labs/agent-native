import { createHash, randomUUID } from 'node:crypto';

const maxBytes = 4 * 1024 * 1024;

// The operator chooses one origin. Redirects are evidence and are never followed with credentials.
async function readResponse(url, origin) {
  const target = new URL(url);
  if (
    target.origin !== origin ||
    target.username ||
    target.password ||
    !['http:', 'https:'].includes(target.protocol)
  )
    throw Error('invalid-target');
  const response = await fetch(target, {
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(10000),
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw Error('response-too-large');
    chunks.push(chunk);
  }
  return {
    status: response.status,
    type: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
    bytes: Buffer.concat(chunks),
  };
}

// The CLI can attest only to protocols for which it has an independent read-only probe.
export async function verifyProtocol(declaration) {
  if (declaration.protocol !== 'openapi') return false;
  const reply = await readResponse(declaration.url, new URL(declaration.url).origin);
  if (reply.status !== 200 || !/^(application\/(?:json|[\w.+-]+\+json))$/.test(reply.type))
    return false;
  const doc = JSON.parse(reply.bytes.toString('utf8'));
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
  return (
    /^3\.\d+\.\d+$/.test(doc?.openapi) &&
    typeof doc.info?.title === 'string' &&
    doc.info.title.trim().length > 0 &&
    typeof doc.info?.version === 'string' &&
    doc.info.version.trim().length > 0 &&
    record(doc.paths) &&
    Object.entries(doc.paths).some(
      ([path, item]) =>
        path.startsWith('/') &&
        record(item) &&
        Object.entries(item).some(
          ([method, operation]) =>
            methods.has(method) &&
            record(operation) &&
            record(operation.responses) &&
            Object.entries(operation.responses).some(
              ([code, response]) =>
                /^(?:default|[1-5](?:\d\d|XX))$/.test(code) &&
                record(response) &&
                typeof response.description === 'string' &&
                response.description.trim().length > 0,
            ),
        ),
    )
  );
}

function attr(tag, name) {
  const attributes = tag.replace(/^<[\w:-]+/, '');
  for (const [, key, quoted, single, bare] of attributes.matchAll(
    /\s+([^\s=/><]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s><]+)))?/g,
  )) {
    if (key.toLowerCase() === name) return quoted ?? single ?? bare ?? '';
  }
  return '';
}

function textContent(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html
    .replace(/<(script|style|template|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(
      /<\/?(?:p|br|div|main|h[1-6]|li|section|article|tr|td|nav|header|footer)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
      ' ',
    )
    .replace(/<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original;
      const n =
        entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function containsFact(visible, fact) {
  // Require a word boundary where the approved text starts or ends in a word.
  // Otherwise a rate of `19` could match `190` in a contradictory page.
  const words = /[\p{L}\p{N}]/u;
  for (let from = 0; from <= visible.length; ) {
    const at = visible.indexOf(fact, from);
    if (at < 0) return false;
    if (
      (!words.test(fact[0]) || !words.test(visible[at - 1] ?? '')) &&
      (!words.test(fact.at(-1)) || !words.test(visible[at + fact.length] ?? ''))
    )
      return true;
    from = at + 1;
  }
  return false;
}

function canonicalPage(reply, entry, expectedData, source) {
  if (reply.status !== 200 || reply.type !== 'text/html' || !source) return false;
  const html = reply.bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const links =
    head
      .replace(/<(script|style|title|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .match(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  const rel = (tag, value) => attr(tag, 'rel').toLowerCase().split(/\s+/).includes(value);
  const targets = (tag, url) => {
    const href = attr(tag, 'href').trim();
    return href.length > 0 && new URL(href, entry.canonical).href === url;
  };
  const canonicalLinks = links.filter((tag) => rel(tag, 'canonical'));
  if (canonicalLinks.length !== 1 || !targets(canonicalLinks[0], entry.canonical)) return false;

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  if (body === undefined) return false;
  const visible = textContent(body);
  if (visible) {
    const facts = source.markdown
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '').trim())
      .filter(Boolean);
    if (
      !facts.length ||
      facts.some((line) => {
        const text = line.replace(/\s+/g, ' ');
        return (
          !containsFact(visible, text) &&
          !containsFact(visible, text.replace(/(\*\*|__|~~|`|\*)(.+?)\1/g, '$2'))
        );
      })
    )
      return false;
  } else {
    // A JS-only shell must point anonymous clients to the exact, byte-verified mirror.
    if (
      !links.some(
        (tag) =>
          rel(tag, 'alternate') &&
          attr(tag, 'type').toLowerCase() === 'text/markdown' &&
          targets(tag, entry.mirror),
      ) ||
      !(html.match(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []).some((tag) =>
        attr(tag, 'src').trim(),
      )
    )
      return false;
  }
  if (!expectedData) return true;
  for (const script of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
    if (attr(script[1], 'type').toLowerCase() !== 'application/ld+json') continue;
    const data = JSON.parse(script[2]);
    const nodes = Array.isArray(data) ? data : [data, ...(data?.['@graph'] ?? [])];
    if (
      nodes.some(
        (node) => node && Object.entries(expectedData).every(([key, val]) => node[key] === val),
      )
    )
      return true;
  }
  return false;
}

// Validate the entire probe list before making any request. A private or malformed
// target must never appear in an error receipt, including the URL's userinfo.
function probeTarget(probe, base) {
  if (
    !probe ||
    typeof probe !== 'object' ||
    Array.isArray(probe) ||
    Object.keys(probe).some(
      (key) => !['path', 'status', 'type', 'contains', 'excludes'].includes(key),
    ) ||
    typeof probe.path !== 'string' ||
    !probe.path ||
    /[?#\\\s]/u.test(probe.path) ||
    probe.path.startsWith('//') ||
    !Number.isInteger(probe.status) ||
    probe.status < 100 ||
    probe.status > 599 ||
    (probe.type !== undefined &&
      (typeof probe.type !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(probe.type)))
  )
    return null;
  for (const list of [probe.contains, probe.excludes]) {
    if (
      list !== undefined &&
      (!Array.isArray(list) || !list.every((s) => typeof s === 'string' && s.trim()))
    )
      return null;
  }
  try {
    const url = new URL(probe.path, base);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(base.pathname)
    )
      return null;
    for (const part of probe.path.split('/')) {
      const decoded = decodeURIComponent(part);
      if (
        decoded === '.' ||
        decoded === '..' ||
        /[\\/%?#\s]/u.test(decoded) ||
        [...decoded].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      )
        return null;
    }
    return url;
  } catch {
    return null;
  }
}

export async function verifyPublication(plan, config, probes = {}, candidates = []) {
  const base = new URL(config.siteUrl.replace(/\/?$/, '/'));
  const checks = [];
  if (
    !probes ||
    typeof probes !== 'object' ||
    Array.isArray(probes) ||
    Object.keys(probes).some((key) => key !== 'responses') ||
    (probes.responses !== undefined && !Array.isArray(probes.responses))
  )
    return { status: 'failed', code: 'invalid-probe', checks };
  const responses = probes.responses ?? [];
  const targets = responses.map((probe) => probeTarget(probe, base));
  if (targets.some((target) => !target)) return { status: 'failed', code: 'invalid-probe', checks };
  async function check(url, test, inspect, identity = { url }) {
    try {
      const reply = await readResponse(url, base.origin);
      const pass = Boolean(inspect(reply));
      checks.push({ test, ...identity, pass, status: reply.status, type: reply.type });
    } catch (error) {
      checks.push({
        test,
        ...identity,
        pass: false,
        error: error.name === 'TimeoutError' ? 'timeout' : 'request-or-validation-failed',
      });
    }
  }
  if (!config.enabled || !plan.assets.length)
    return { status: 'failed', code: 'no-active-publication', checks };
  for (const asset of plan.assets) {
    const expected = asset.mediaType.split(';')[0];
    await check(new URL(asset.path, base).href, 'published-bytes', (r) => {
      const type =
        r.type === expected ||
        (expected === 'text/markdown' && r.type === 'text/plain') ||
        (expected === 'application/ld+json' && r.type === 'application/json');
      return (
        r.status === 200 &&
        type &&
        createHash('sha256').update(r.bytes).digest('hex') === asset.digest
      );
    });
  }
  const sources = new Map(candidates.map((source) => [source.id, source]));
  for (const entry of plan.manifest.entries.filter((x) => x.status === 'included')) {
    const data =
      entry.structuredData &&
      plan.assets.find((asset) => new URL(asset.path, base).href === entry.structuredData);
    await check(entry.canonical, 'human-page', (r) =>
      canonicalPage(r, entry, data ? JSON.parse(data.content) : null, sources.get(entry.sourceId)),
    );
  }
  await check(
    new URL(`agent-native/missing-${randomUUID()}.md`, base).href,
    'missing-mirror',
    (r) => r.status === 404 || r.status === 410,
  );
  for (const [index, probe] of responses.entries()) {
    const url = targets[index];
    await check(
      url.href,
      'declared-response',
      (r) => {
        const body = r.bytes.toString('utf8');
        return (
          r.status === probe.status &&
          (!probe.type || r.type === probe.type) &&
          (probe.contains ?? []).every(
            (value) => typeof value === 'string' && value.length && body.includes(value),
          ) &&
          (probe.excludes ?? []).every(
            (value) => typeof value === 'string' && value.length && !body.includes(value),
          )
        );
      },
      { probe: index + 1 },
    );
  }
  return { status: checks.every((c) => c.pass) ? 'verified' : 'failed', checks };
}
