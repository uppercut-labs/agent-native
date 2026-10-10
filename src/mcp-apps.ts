import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { type CapabilityDefinition, canonicalCapabilityId } from './core/contracts.js';
import type { CapabilityRegistry } from './core/registry.js';
import {
  createMcpHandlerWithAppRegistration,
  type McpAdapterOptions,
  type McpAppRegistration,
  type McpAppResourceDefinition,
} from './mcp.js';

const MAX_RESOURCE_BYTES: number = 1024 * 1024;
const URI_PATTERN: RegExp = /^ui:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[A-Za-z0-9._~/-]+$/;

export type McpAppResource = McpAppResourceDefinition;

export type McpAppsOptions = McpAdapterOptions & {
  readonly resources: readonly McpAppResource[];
};

type McpAppResourceContents = {
  contents: { uri: string; mimeType: string; text: string }[];
};

const RESOURCE_TAG_PATTERN: RegExp = /<[a-z][a-z0-9:-]*\b/gi;
const URL_ATTRIBUTE_PATTERN: RegExp =
  /\b(src|href|srcset|poster|action|formaction|data|xlink:href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/gi;

function hasUnsafeResourceUrl(html: string): boolean {
  for (const tag of html.matchAll(RESOURCE_TAG_PATTERN)) {
    let end: number = (tag.index ?? 0) + tag[0].length;
    const start: number = end;
    let quote: '"' | "'" | null = null;
    for (; end < html.length; end += 1) {
      const character: string | undefined = html[end];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end === html.length) return true;
    const attributes: string = html.slice(start, end);
    // Hosts supply the CSP; an embedded refresh directive must not navigate around it.
    if (tag[0].toLowerCase() === '<meta' && /\bhttp-equiv\s*=/i.test(attributes)) return true;
    for (const match of attributes.matchAll(URL_ATTRIBUTE_PATTERN)) {
      const attribute: string | undefined = match[1]?.toLowerCase();
      const value: string = match[2] ?? match[3] ?? match[4] ?? '';
      // Entity or control decoding can turn an apparently local URL into a remote one.
      if (
        value.includes('&') ||
        Array.from(value).some((character: string): boolean => {
          const code: number = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      )
        return true;
      if (attribute === 'style') {
        if (/@import|url\s*\(|\\/i.test(value)) return true;
        continue;
      }
      const urls: readonly string[] =
        attribute === 'srcset'
          ? value
              .split(',')
              .map((candidate: string): string => candidate.trim().split(/\s+/)[0] ?? '')
          : [value.trim()];
      if (urls.some((url: string): boolean => /^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(url)))
        return true;
    }
  }
  return false;
}

function validateResource(resource: McpAppResource): void {
  if (!URI_PATTERN.test(resource.uri) || resource.uri.length > 256) {
    throw new TypeError('MCP App resource URI must be a bounded ui:// URI.');
  }
  if (resource.uri.split('/').some((part: string): boolean => part === '.' || part === '..')) {
    throw new TypeError('MCP App resource URI cannot contain traversal segments.');
  }
  if (
    resource.name.trim().length === 0 ||
    resource.name.length > 120 ||
    Buffer.byteLength(resource.html, 'utf8') > MAX_RESOURCE_BYTES
  ) {
    throw new TypeError('MCP App resource metadata or HTML exceeds its bound.');
  }
  const externalElement: boolean = hasUnsafeResourceUrl(resource.html);
  const cssBlocks: readonly RegExpExecArray[] = [
    ...resource.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
  ];
  // Resource styles stay self-contained; reject URL functions, imports, and CSS escapes.
  const externalCss: boolean = cssBlocks.some((match: RegExpExecArray): boolean =>
    /@import|url\s*\(|\\/i.test(match[1] ?? ''),
  );
  if (externalElement || externalCss) {
    throw new TypeError('MCP App resource cannot declare external origins.');
  }
}

function resourceKey(resource: McpAppResource): string {
  if (!resource.capabilityId.includes(':') || !resource.capabilityId.includes('@')) {
    throw new TypeError('MCP App resource must name a canonical capability id.');
  }
  return resource.capabilityId;
}

export function validateMcpAppResources(
  registry: CapabilityRegistry,
  resources: readonly McpAppResource[],
): readonly McpAppResource[] {
  const known: ReadonlySet<string> = new Set(
    registry.definitions.map((definition: CapabilityDefinition<unknown, unknown>): string =>
      canonicalCapabilityId(definition.identity),
    ),
  );
  let byCapability: Set<string> = new Set();
  let byUri: Set<string> = new Set();
  let validated: McpAppResource[] = [];
  for (const resource of resources) {
    const candidate: McpAppResource = Object.freeze({
      capabilityId: resource.capabilityId,
      uri: resource.uri,
      name: resource.name,
      html: resource.html,
    });
    validateResource(candidate);
    const capabilityId: string = resourceKey(candidate);
    if (!known.has(capabilityId)) {
      throw new TypeError('MCP App resource refers to an undeclared capability.');
    }
    if (byCapability.has(capabilityId) || byUri.has(candidate.uri)) {
      throw new TypeError('MCP App resource capability and URI mappings must be unique.');
    }
    byCapability.add(capabilityId);
    byUri.add(candidate.uri);
    validated.push(candidate);
  }
  return Object.freeze(validated);
}

function createRegistration(resources: readonly McpAppResource[]): McpAppRegistration {
  const byCapability: ReadonlyMap<string, McpAppResource> = new Map(
    resources.map((resource: McpAppResource): [string, McpAppResource] => [
      resource.capabilityId,
      resource,
    ]),
  );
  return {
    resources,
    registerTool(
      server: McpServer,
      name: string,
      config: Parameters<McpAppRegistration['registerTool']>[2],
      handler: (input: unknown) => Promise<CallToolResult>,
      resourceUri: string,
    ): void {
      registerAppTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(
        server,
        name,
        {
          ...config,
          _meta: {
            ui: {
              resourceUri,
              visibility: ['model', 'app'],
            },
          },
        },
        handler,
      );
    },
    registerResources(server: McpServer, visibleResources: readonly McpAppResource[]): void {
      for (const resource of visibleResources) {
        if (byCapability.get(resource.capabilityId) !== resource) {
          throw new Error('Refusing to register an undeclared MCP App resource.');
        }
        registerAppResource(
          server,
          resource.name,
          resource.uri,
          {
            description: 'Bundled interactive view for an existing capability.',
            _meta: {
              ui: {
                csp: {
                  connectDomains: [],
                  resourceDomains: [],
                  frameDomains: [],
                  baseUriDomains: [],
                },
                prefersBorder: true,
              },
            },
          },
          async (requestedUri: URL): Promise<McpAppResourceContents> => {
            if (requestedUri.href !== resource.uri) {
              throw new Error('MCP App resource URI is not declared.');
            }
            return {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: RESOURCE_MIME_TYPE,
                  text: resource.html,
                },
              ],
            };
          },
        );
      }
    },
  };
}

export function createMcpAppsHandler(
  registry: CapabilityRegistry,
  options: McpAppsOptions,
): (request: Request) => Promise<Response> {
  const resources: readonly McpAppResourceDefinition[] = validateMcpAppResources(
    registry,
    options.resources,
  );
  const registration: McpAppRegistration = createRegistration(resources);
  return createMcpHandlerWithAppRegistration(registry, options, registration);
}
