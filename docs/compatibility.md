# Compatibility

## Fixture-tested

| Target | Evidence | Claim |
| --- | --- | --- |
| Node.js 25.9.0 local HTTP socket | Official client and server SDKs 2.3.0; client reports negotiated protocol 2025-11-25 | Fixture-tested |

The fixture exercises tools/list and tools/call through the official Streamable HTTP client and
server APIs. It also sends malformed transport input and an oversized request through the SDK
handler, then uses an official client for invalid arguments and direct hidden-tool calls. Hidden
bindings remain uncalled. The exact commands and outcomes are recorded in evidence/UAN-005.md.

## Unverified

No named commercial client, framework-specific mount, Cloudflare Workerd runtime, production
deployment, OAuth authorization server, or physical host was tested. The protocol fixture is not a
claim of universal MCP client or provider compatibility. Node versions other than the local test
host remain unverified for this adapter.
