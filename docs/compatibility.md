# Compatibility and evidence

Agent Native `0.1.1` is a preview. The table describes the exact local
fixtures; it is not a claim for all releases of a runtime or every client.

| Surface | Runnable check | Verified boundary |
| --- | --- | --- |
| Static Astro | `npm run example:e01` | Astro 7.3.5 static build and simulated WebMCP lifecycle; native Chrome 155 WebMCP (opt-in feature) [evidence](evidence/UAN-023-native-webmcp-chrome.md) |
| Astro on-demand | `npm run example:e02` | Astro 7.3.5 with its existing Node adapter, HTTP route and official MCP SDK client |
| Next App Router | `npm run example:e03` | Next 16.3.8 on Node, production route smoke and browser artifact scan |
| Cloudflare Worker | `npm run example:e04` | Wrangler 4.147.0 local workerd, HTTP/OpenAPI and official MCP SDK client |
| Node/Hono | `npm run example:e05` | Hono 4.13.12 and Node adapter 2.1.3 on loopback |
| Browser-only WebMCP | `npm run example:e06` | Simulated `document.modelContext` and native Chrome 155 with the opt-in `WebMCP` feature; ordinary button fallback in default Chrome |
| MCP Apps | `npm run example:e09` | Official ext-apps App/AppBridge fixture and local MCP client; no commercial host claim |
| Codex local harness | `npm run proof:codex -- --model gpt-5.6-luna` (explicit inference opt-in) | CLI 0.145.0, managed ChatGPT login, two file writes and same-thread resume across processes; [evidence](evidence/codex-harness.md) |

Use Node.js 22 or newer and `npm ci` at the repository root before a listed command.
Each command packs the package into an independent exported project; the root
`npm run check` runs all twelve examples on Node 22 and 24 in CI.
The [example coverage manifest](https://github.com/uppercut-labs/agent-native/blob/main/docs-site/coverage.json) maps all E01-E12 scripts, source,
guides, negative probes, requirements and the CI gate. A malformed input or denied request
is part of each example's test, not a successful operation to copy into an application.

For a missing optional peer, install the exact adapter dependency in
[installation](installation.md). For an inert route, check the application's adapter, runtime
and route mapping in [frameworks](frameworks.md). Native browser support is verified only in
Chrome 155 with WebMCP opted in; a simulated `modelContext` cannot prove other browsers. See
[support and limitations](support-and-limitations.md) for the release boundary.
