# Framework support

This table records framework surfaces actually built and checked in this package. It is not a
compatibility promise for every release in a listed major version.

| Framework | Supported shape | Verified environment | Boundary |
| --- | --- | --- | --- |
| Astro | Static browser bootstrap or application-owned on-demand HTTP/MCP routes | Astro 7.3.5, `@astrojs/node` 11.1.6, Node 22.12+ fixtures | Integration installs no adapter; on-demand mode requires a supported application adapter |
| Hono | One Node application mounting the Web-standard HTTP and MCP handlers | Hono 4.13.12, `@hono/node-server` 2.1.3, Node 22+ E05 fixture | Loopback lab host; no provider deployment or production identity integration |

The Astro integration uses the documented `astro:config:setup` page-script injection hook and
`astro:config:done` output diagnostic. `mode: 'on-demand'` permits Astro's server build mode while
the application owns its routes and adapter; it does not create either. E01 preserves a wholly
static build. E02 preserves prerendered pages and human navigation while live `/agent-native/v1/*`
and `/mcp` routes reuse the framework-neutral HTTP/MCP handlers.

The experimental [existing-project init](getting-started.md) can patch only an Astro config with
the recognized literal static shape. It records a reviewed sidecar origin and generates a browser
entry, then verifies the built E01 site from a local package tarball. More complex Astro config,
on-demand configs, and other frameworks require manual integration. Detection reports on-demand
routes, a missing server adapter, and protocol-looking static files; it never recommends the
historical `output: 'hybrid'` value.

The browser capability host remains experimental. E01 exercises a simulated WebMCP API in Node
tests, not a real browser or agent. Other Astro releases, server output, deployment providers, and
real-host WebMCP behavior are unverified. E02 proves only the pinned local Node standalone adapter;
it is not a claim about other adapters or external hosts.

E05 follows Hono's official Node adapter shape: the Hono router receives Fetch API requests and
`@hono/node-server` owns the Node HTTP socket. The package's `createHttpHandler` and
`createMcpHandler` remain framework-neutral and are mounted into the same Hono app. The fixture
checks HTTP and the official MCP client against one registry, binds loopback by default, and handles
SIGINT/SIGTERM and listen errors. This verifies the pinned fixture only, not every Hono release or a
deployed host.

Astro references: [integration hooks](https://docs.astro.build/en/reference/integrations-reference/)
and [ClientRouter lifecycle](https://docs.astro.build/en/guides/view-transitions/).
Hono reference: [official Node.js adapter guide](https://hono.dev/docs/getting-started/nodejs).
