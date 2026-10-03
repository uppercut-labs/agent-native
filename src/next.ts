import type { CapabilityRegistry } from './core/registry.js';
import { createHttpHandler, type HttpAdapterOptions } from './http.js';
import { createMcpHandler, type McpAdapterOptions } from './mcp.js';

export type NextRouteHandler = (request: Request) => Promise<Response>;

export type NextRouteHandlers = {
  readonly GET: NextRouteHandler;
  readonly POST: NextRouteHandler;
  readonly DELETE: NextRouteHandler;
  readonly HEAD: NextRouteHandler;
  readonly OPTIONS: NextRouteHandler;
  readonly PATCH: NextRouteHandler;
  readonly PUT: NextRouteHandler;
};

function exposeRoute(handler: NextRouteHandler): NextRouteHandlers {
  return Object.freeze({
    GET: handler,
    POST: handler,
    DELETE: handler,
    HEAD: handler,
    OPTIONS: handler,
    PATCH: handler,
    PUT: handler,
  });
}

/**
 * Adapts the Web-standard HTTP capability handler to Next App Router exports.
 * Mount the returned methods from a Node-runtime catch-all route that covers the configured base path.
 */
export function createNextHttpRoute(
  registry: CapabilityRegistry,
  options: HttpAdapterOptions = {},
): NextRouteHandlers {
  return exposeRoute(createHttpHandler(registry, options));
}

/**
 * Adapts the official SDK Streamable HTTP MCP handler to Next App Router exports.
 * The owning route module must export `runtime = 'nodejs'` and must be mounted at the endpoint.
 */
export function createNextMcpRoute(
  registry: CapabilityRegistry,
  options: McpAdapterOptions = {},
): NextRouteHandlers {
  return exposeRoute(createMcpHandler(registry, options));
}
