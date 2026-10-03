import { defineCapability } from '@uppercut-labs/agent-native/contracts';
import { bindCapability, createCapabilityRegistry } from '@uppercut-labs/agent-native/registry';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';
import { searchContent } from './existing/content.mjs';

const contentItem = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
});

export const searchContentCapability = defineCapability({
  identity: { namespace: 'content', name: 'search', majorVersion: 1 },
  description: 'Search the existing public content collection.',
  input: fromZod(
    z.object({
      query: z.string().trim().min(1).max(80),
      limit: z.number().int().min(1).max(10).optional(),
    }),
  ),
  output: fromZod(
    z.object({
      query: z.string(),
      results: z.array(contentItem),
    }),
  ),
  risk: 'read',
  access: { kind: 'public' },
  surfaces: {
    // docs:start http-get-override
    http: {
      path: '/api/content/search',
      method: 'GET',
      query: { query: 'q' },
    },
    // docs:end http-get-override
    // docs:start cli-command-override
    cli: {
      command: 'content-search',
      aliases: ['search'],
    },
    // docs:end cli-command-override
  },
});

export const searchContentBinding = bindCapability(searchContentCapability, {
  id: 'existing-content-search',
  targets: ['local', 'server'],
  execute: searchContent,
});

export const registry = createCapabilityRegistry([searchContentCapability], [searchContentBinding]);

export const publicReadAuthorization = {
  authorize(request) {
    return request.risk === 'read' && request.access.kind === 'public';
  },
};
