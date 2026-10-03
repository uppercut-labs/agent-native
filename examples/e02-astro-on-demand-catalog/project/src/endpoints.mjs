import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { createMcpHandler } from '@uppercut-labs/agent-native/mcp';
import { registry, resolveExecutionContext } from './catalog.mjs';

export const httpEndpoint = createHttpHandler(registry, { resolveExecutionContext });
export const mcpEndpoint = createMcpHandler(registry, { resolveExecutionContext });
