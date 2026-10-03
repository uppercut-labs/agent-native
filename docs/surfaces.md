# Adapter surfaces

All adapters project the same capability definitions and invoke the shared executor. Adapters are separate package subpaths; importing a surface does not make unrelated runtime SDKs part of the root entrypoint.

| Surface | Package subpath | Typical runtime | Discovery and call boundary |
| --- | --- | --- | --- |
| Local core | @uppercut-labs/agent-native | Application runtime | Explicit registry binding and AuthorizationPort |
| Browser | /browser | Browser bundle | Browser-target binding; per-call exposure and authorization |
| CLI | /cli | Node.js | Local/server bindings filtered per invocation and caller |
| HTTP/OpenAPI | /http | Web-standard server runtime | Bound public-read projection; request body and deadline bounds |
| MCP Streamable HTTP | /mcp | MCP server runtime | Official server SDK; request discovery plus per-call authorization |
| MCP Apps | /mcp-apps | MCP server plus optional ext-apps peer | Existing MCP call with a declared UI resource; view calls through host |

The MCP Apps adapter is optional. Core and browser consumers should import only their needed subpaths. The adapter pins the tested official peer at 2.0.3 and does not require React or another UI framework. E09 bundles a vanilla JavaScript view and reuses E01's album contract and data.

The local conformance fixture verifies SDK-level result delivery and a host-mediated follow-up, but it does not prove a real iframe, CSP implementation, a commercial host, user confirmation prompts, or deployment. Real host qualification is tracked by UAN-023.

## Choose a tested path

Start with Node.js 22 or newer, `npm ci`, then `npm run example:e12` for a local
binding or `npm run example:e05` for loopback HTTP/MCP. E12 prints a versioned
conversion envelope; E05 checks both handlers from one registry. If a browser lacks
`document.modelContext`, keep the ordinary human UI and use
[browser-local fallback](browser.md). If a server adapter cannot load its optional
peer, use [installation](installation.md) before mounting a route.
