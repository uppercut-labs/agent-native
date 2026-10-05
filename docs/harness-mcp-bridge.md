# Local harness MCP bridge

Import `startHarnessMcpBridge` from `@uppercut-labs/agent-native/harness/mcp-bridge`
in Node 22+. It serves an application-supplied Web Request/Response MCP handler
on `127.0.0.1` at `/mcp`, using an ephemeral port by default. It refuses public
binds and validates Host/Origin, preserving handler authentication and capability
authorization. It does not import the MCP SDK or mint credentials.

```ts
const bridge = await startHarnessMcpBridge({ handler: applicationMcpHandler });
try {
  // Configure the local provider to connect to bridge.url.
} finally {
  await bridge.close();
}
```

`port` may be 0-65535. `maxRequestBytes` defaults to 32768 (1-1048576), and
`deadlineMs` defaults to 30000 (1-300000), including response streaming. Oversized
requests receive 413; deadlines abort the request and return 504 before headers
or close an already streaming response. Handler errors produce a fixed diagnostic
and 500 or stream closure. Handlers must honor AbortSignal to release their own work.
Idempotent `close()` aborts active requests and closes only owned connections.

Loopback is reachable by local processes and is not an authorization grant.
Anonymous MCP initialization may succeed while protected calls stay denied.
Application policy remains authoritative at discovery and execution. Cloud agents
need a caller-supplied reachable authenticated endpoint; this helper never creates
a public bind or tunnel. See [MCP policy](mcp.md) and
[harness contracts](programmatic-harness.md).
