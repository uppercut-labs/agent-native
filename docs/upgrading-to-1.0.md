# Upgrading from 0.1.x to 1.0

1.0 is the first release with a [stability promise](stability.md). Most 0.1.3 code runs unchanged. Check these points.

## Protected-only MCP servers now ask for a token

With `bearerAuth` configured and no capability that is a public read, a request without an `Authorization` header gets the SDK's 401 challenge (`WWW-Authenticate: Bearer`). In 0.1.x it completed an anonymous handshake with an empty tool list. To keep the old behavior, set `bearerAuth.required: false`. To require a token even when public reads exist, set it to `true`.

## Bindings receive the caller

`BindingExecutionContext` has a new required `caller` field. Bindings that only read the context need no change. They can now read `context.caller.identity` (`issuer`, `subject`, `tenantId`, `clientId`) to scope records instead of rebuilding the registry per request. Code that builds a context by hand, for example in a unit test that calls a binding directly, must pass `caller`.

## MCP Apps plumbing is no longer exported from `./mcp`

`createMcpHandlerWithAppRegistration`, `McpAppRegistration` and `McpAppResourceDefinition` were internal helpers of the MCP Apps adapter. Use `createMcpAppsHandler` and the `McpAppResource` type from `@uppercut-labs/agent-native/mcp-apps` instead.

## Zod peer range

The `schema/zod` adapter accepts Zod 4.6.x (`~4.6.5`). Zod releases before 4.6 are not supported; 4.0.0 fails JSON Schema conversion.

## New, optional

- `onToolFailure` on the MCP adapter reports why a tool call failed, without inputs, outputs or exception text.
- `toolName` on the MCP adapter sets readable tool names.

See the [MCP guide](mcp.md) for details.
