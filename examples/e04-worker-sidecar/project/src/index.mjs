import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { createMcpHandler } from '@uppercut-labs/agent-native/mcp';
import { catalogRevision, registry } from './catalog.mjs';
// docs:start worker-transports
const http = createHttpHandler(registry, {
  basePath: '/agent-native/v1',
  maxRequestBytes: 8192,
  deadlineMs: 5000,
});
const mcp = createMcpHandler(registry, {
  endpoint: '/mcp',
  maxRequestBytes: 8192,
  deadlineMs: 5000,
});
// docs:end worker-transports
const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
const withCors = (r, origin) => {
  const h = new Headers(r.headers);
  if (origin === undefined || origin === '')
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  h.set('access-control-allow-origin', origin);
  h.set('vary', 'Origin');
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  h.set(
    'access-control-allow-headers',
    'content-type, accept, mcp-session-id, mcp-protocol-version',
  );
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
};
export default {
  async fetch(req, env) {
    const url = new URL(req.url),
      host = req.headers.get('host');
    if (
      typeof env.SIDECAR_HOST !== 'string' ||
      !env.SIDECAR_HOST ||
      url.hostname.toLowerCase() !== env.SIDECAR_HOST.toLowerCase() ||
      host?.toLowerCase() !== url.host.toLowerCase()
    )
      return json(
        {
          error: {
            code: 'invalid_host',
            message: 'Request host is not configured for this Worker.',
          },
        },
        421,
      );
    const origin = req.headers.get('origin');
    if (origin !== null && (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN))
      return json(
        { error: { code: 'invalid_origin', message: 'Request origin is not allowed.' } },
        403,
      );
    const path = url.pathname;
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin);
    if (path === '/health' && req.method === 'GET') {
      if (typeof env.CATALOG_REVISION !== 'string' || !env.CATALOG_REVISION)
        return withCors(
          json(
            {
              status: 'unavailable',
              code: 'missing_catalog_binding',
              message: 'Set CATALOG_REVISION to the shared public catalog revision.',
              expectedRevision: catalogRevision,
            },
            503,
          ),
          origin,
        );
      if (env.CATALOG_REVISION !== catalogRevision)
        return withCors(
          json(
            {
              status: 'unavailable',
              code: 'catalog_revision_mismatch',
              message: 'Update the sidecar to match the static catalog revision.',
              expectedRevision: catalogRevision,
              configuredRevision: env.CATALOG_REVISION,
            },
            503,
          ),
          origin,
        );
      return withCors(
        json(
          { status: 'ok', catalogRevision, capabilities: ['example.catalog:album.lookup@1'] },
          200,
        ),
        origin,
      );
    }
    if (typeof env.CATALOG_REVISION !== 'string' || env.CATALOG_REVISION !== catalogRevision)
      return withCors(
        json(
          {
            error: {
              code:
                typeof env.CATALOG_REVISION === 'string'
                  ? 'catalog_revision_mismatch'
                  : 'missing_catalog_binding',
              message: 'Sidecar catalog configuration is unavailable.',
            },
          },
          503,
        ),
        origin,
      );
    if (path === '/mcp') return withCors(await mcp(req), origin);
    if (path.startsWith('/agent-native/v1/')) return withCors(await http(req), origin);
    return withCors(
      json(
        {
          error: {
            code: 'route_not_configured',
            message: 'Configure host routing for this path or use the sidecar URL.',
          },
        },
        404,
      ),
      origin,
    );
  },
};
