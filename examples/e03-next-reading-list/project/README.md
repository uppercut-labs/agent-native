# E03 Next.js reading list integration

E03 preserves the committed pre-integration site at `../site-before` and exports this directory as
a standalone Next.js 16.3.8 Node-runtime project. One browser-safe catalog definition drives the
Next HTTP route, the official MCP server route, and the optional browser tool. Existing catalog,
saved-list, layout, and fixture-auth behavior remain in place.

## Reproducible quickstart

From the package repository root, run:

```sh
npm run example:e03
```

The exporter builds and packs Agent Native, copies this project, creates a local tarball dependency,
generates a lockfile, installs with `npm ci`, runs the fixture tests, builds Next production output,
and scans server and browser artifacts. Dependencies are exact pins: Next `16.3.8`, React and React
DOM `19.3.0`, and MCP client `2.3.0`. Node.js 22 or newer is required.

Expected final lines include:

```text
route smoke: existing routes, Next HTTP adapter, and official MCP client passed
server boundary: sentinel present in ... server artifacts and absent from ... browser artifacts
Standalone e03-next-reading-list installed and tested at .../.exported
```

## Routes and fallback

- `/agent-native/v1/...` delegates real Web `Request` objects to the shared HTTP executor.
- `/mcp` delegates Streamable HTTP to the official MCP SDK through the same server registry.
- The client bootstrap resyncs the browser registry when `usePathname()` changes. It only registers
  when `document.modelContext.registerTool` exists; otherwise the ordinary reading page and JSON
  routes work unchanged and display a normal-browser fallback message.
- `/api/catalog` and `/api/saved-list` are pre-existing routes and are intentionally not rewritten.

The negative authorization case remains executable: `npm test` proves an Alex fixture identity
cannot save to Mina's list and cannot forge an identity with an arbitrary user-shaped object. The
fixture token mapper is sample code, not production authentication.

## Source boundary proof

`lib/server-registry.js`, `lib/saved-list.js`, and `lib/fixture-identity.js` are server-only. The
production build must contain the deliberately fake sentinel in a server artifact and in no browser
JavaScript or browser source map. Browser code imports only `lib/catalog-capability.js`, public
catalog JSON, the core registry, and the isolated `next/browser` adapter.

## Explicit limits

This fixture verifies Next 16.3.8 on the local Node runtime, a local HTTP socket, the official MCP
client, production build artifacts, and a simulated WebMCP registration API in package tests. It
does not verify Vercel, another provider runtime, Edge runtime, a physical browser agent host,
OAuth, durable storage, cross-process list consistency, or deployment. The App Router module must
declare `runtime = 'nodejs'`; route conflicts require a reviewed path choice rather than overwrite.
