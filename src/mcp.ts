// Public remote MCP entry point. The implementation and the MCP Apps registration plumbing live in
// mcp-core.ts, which the package does not export.
export type {
  McpAdapterOptions,
  McpExecutionContext,
  McpToolFailure,
  McpToolFailureReason,
  McpToolSecurityScheme,
} from './mcp-core.js';
export { createMcpHandler, mcpToolName } from './mcp-core.js';
