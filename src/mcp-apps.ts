import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { canonicalCapabilityId } from './core/contracts.js';
import type { CapabilityRegistry } from './core/registry.js';
import {
  createMcpHandlerWithAppRegistration,
  type McpAdapterOptions,
  type McpAppRegistration,
  type McpAppResourceDefinition,
} from './mcp.js';

const MAX_RESOURCE_BYTES = 1024 * 1024;
const URI_PATTERN = /^ui:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[A-Za-z0-9._~/-]+$/;

export type McpAppResource = McpAppResourceDefinition;

export type McpAppsOptions = McpAdapterOptions & {
  readonly resources: readonly McpAppResource[];
};

function validateResource(resource: McpAppResource): void {
  if (!URI_PATTERN.test(resource.uri) || resource.uri.length > 256) {
    throw new TypeError('MCP App resource URI must be a bounded ui:// URI.');
  }
  if (resource.uri.split('/').some((part) => part === '.' || part === '..')) {
    throw new TypeError('MCP App resource URI cannot contain traversal segments.');
  }
  if (
    resource.name.trim().length === 0 ||
    resource.name.length > 120 ||
    Buffer.byteLength(resource.html, 'utf8') > MAX_RESOURCE_BYTES
  ) {
    throw new TypeError('MCP App resource metadata or HTML exceeds its bound.');
  }
  const externalElement =
    /<(?:script|iframe|link|img|source|video|audio)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i;
  const cssBlocks = [...resource.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  const externalCss = cssBlocks.some((match) =>
    /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\//i.test(
      match[1] ?? '',
    ),
  );
  if (externalElement.test(resource.html) || externalCss) {
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
  const known = new Set(
    registry.definitions.map((definition) => canonicalCapabilityId(definition.identity)),
  );
  const byCapability = new Set<string>();
  const byUri = new Set<string>();
  for (const resource of resources) {
    validateResource(resource);
    const capabilityId = resourceKey(resource);
    if (!known.has(capabilityId)) {
      throw new TypeError('MCP App resource refers to an undeclared capability.');
    }
    if (byCapability.has(capabilityId) || byUri.has(resource.uri)) {
      throw new TypeError('MCP App resource capability and URI mappings must be unique.');
    }
    byCapability.add(capabilityId);
    byUri.add(resource.uri);
  }
  return resources;
}

function createRegistration(resources: readonly McpAppResource[]): McpAppRegistration {
  const byCapability = new Map(resources.map((resource) => [resource.capabilityId, resource]));
  return {
    resources,
    registerTool(server, name, config, handler, resourceUri) {
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
    registerResources(server, visibleResources) {
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
          async (requestedUri) => {
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
  const resources = validateMcpAppResources(registry, options.resources);
  const registration = createRegistration(resources);
  return createMcpHandlerWithAppRegistration(registry, options, registration);
}
