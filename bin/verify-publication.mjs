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
  return (
    /^3\.\d+\.\d+$/.test(doc.openapi) &&
    typeof doc.info?.title === 'string' &&
    typeof doc.info?.version === 'string' &&
    !!doc.paths &&
    typeof doc.paths === 'object' &&
    !Array.isArray(doc.paths) &&
    Object.keys(doc.paths).some((path) => path.startsWith('/'))
  );
}

function attr(tag, name) {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\\s>]+))`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function canonicalPage(reply, entry, expectedData) {
  if (reply.status !== 200 || reply.type !== 'text/html') return false;
  const html = reply.bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const links =
    head.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').match(/<link\b[^>]*>/gi) ?? [];
  const canonicalLinks = links.filter((tag) =>
    attr(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical'),
  );
  if (
    canonicalLinks.length !== 1 ||
    new URL(attr(canonicalLinks[0], 'href'), entry.canonical).href !== entry.canonical
  )
    return false;
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

export async function verifyPublication(plan, config, probes = {}) {
  const base = new URL(config.siteUrl.replace(/\/?$/, '/'));
  const checks = [];
  async function check(url, test, inspect) {
    try {
      const reply = await readResponse(url, base.origin);
      const pass = Boolean(inspect(reply));
      checks.push({ test, url, pass, status: reply.status, type: reply.type });
    } catch (error) {
      checks.push({
        test,
        url,
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
  for (const entry of plan.manifest.entries.filter((x) => x.status === 'included')) {
    const data =
      entry.structuredData &&
      plan.assets.find((asset) => new URL(asset.path, base).href === entry.structuredData);
    await check(entry.canonical, 'human-page', (r) =>
      canonicalPage(r, entry, data ? JSON.parse(data.content) : null),
    );
  }
  await check(
    new URL(`.agent-native-missing-${randomUUID()}.md`, base).href,
    'missing-mirror',
    (r) => r.status === 404 || r.status === 410,
  );
  for (const probe of probes.responses ?? []) {
    const url = new URL(probe.path, base);
    if (url.origin !== base.origin || !Number.isInteger(probe.status)) throw Error('invalid-probe');
    await check(url.href, 'declared-response', (r) => {
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
    });
  }
  return { status: checks.every((c) => c.pass) ? 'verified' : 'failed', checks };
}
