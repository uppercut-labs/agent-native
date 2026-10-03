# Static sites

Agent Native's Astro integration is an experimental browser bootstrap for static and mixed Astro output. It
injects an application-owned browser module through Astro's supported
astro:config:setup injectScript('page', ...) hook. The hook is Vite-bundled as a page module; the
application keeps ownership of its registry, browser bindings, and user interface.

The [experimental init API](getting-started.md) patches a narrowly recognized static Astro config
and writes an owned browser entry plus sidecar-origin settings. Its generated entry only signals
readiness; it does not register an application capability. The E01 retrofit fixture builds from a
local package tarball and checks that the selected origin appears in the browser bundle.

Pure static builds use the default mode. A mixed application explicitly selects
`agentNativeAstro({ browserEntry, mode: 'on-demand' })`, keeps `output: 'static'`, marks endpoint
routes `prerender = false`, and configures a supported adapter. Do not use the removed historical
`output: 'hybrid'` value. The integration checks final build output, but does not add an adapter,
endpoint, sidecar, or hosting configuration. The
feature-detected WebMCP adapter is separate from Astro and is unavailable in hosts that do not
implement the draft API.

For Astro ClientRouter navigation, injected scripts execute once and must resync on
astro:page-load; retire page-owned registrations on astro:before-swap. The E01 fixture also
resyncs on Window pageshow after back-forward cache restoration. Astro's router retains its
normal human-navigation fallback; a missing WebMCP host leaves the page's HTML album search
available and displays a status message.

## Optional Worker sidecar

E01 remains a static Astro site. E04 is a separate Cloudflare Worker that serves the shared public
album contract over HTTP/OpenAPI and MCP; it is not an Astro server adapter and does not create a
same-origin route automatically.

Run npm run example:e01 to build and verify the static fixture. Run npm run example:e04 to export
and install E04, run negative-path tests, build/scan the Worker bundle with Wrangler dry-run, and
exercise the Worker locally through Wrangler/workerd. No production deploy is performed.

The E04 wrangler.jsonc values are explicit:

- CATALOG_REVISION must match the SHA-256 of ordered public album records in the static fixture.
- SIDECAR_HOST is the accepted Worker hostname; the local fixture uses 127.0.0.1.
- ALLOWED_ORIGIN is the exact static-site origin permitted for browser health/HTTP requests; the
  local fixture uses http://localhost:4321.
- PUBLIC_AGENT_NATIVE_SIDECAR_ORIGIN selects the sidecar URL embedded by Astro at build time.
- PUBLIC_AGENT_NATIVE_ROUTE_MODE defaults to sidecar. Set it to same-origin only after the hosting
  layer routes /mcp from the static origin to the Worker.

The browser diagnostic checks the configured sidecar health and shared revision. It distinguishes
an independent sidecar origin from a missing expected same-origin route, a missing revision
binding, and a revision mismatch. Cross-origin browser MCP is not established by this fixture;
the official MCP SDK client check is a server-side local client without a browser Origin. CORS is
limited to the explicitly configured static origin for browser health/HTTP and diagnostics.

The fixture requires no paid binding, account provisioning, DNS change, or production deploy. A
future deployment would need operator-selected host/origin values and a separately authorized
Wrangler deploy; this slice intentionally runs only Wrangler local mode and dry-run bundle inspection.
See [E01 Astro](../examples/e01-album-catalog/project/README.md),
[E04 Worker sidecar](../examples/e04-worker-sidecar/project/README.md),
[UAN-007 evidence](evidence/UAN-007-astro.md), and
[UAN-008 evidence](evidence/UAN-008-worker-sidecar.md).

## Same-origin on-demand endpoints

E02 mounts `createHttpHandler` and `createMcpHandler` in application-owned Astro endpoint files.
The ordinary catalog JSON route and both agent transports reuse one contract and lookup handler;
HTTP and MCP calls also reuse one authorization policy and the package executor's input/output
validation. E02 retains the official Node adapter already configured by its before-state fixture in
standalone mode; Agent Native does not install or configure it. Home, catalog, and unrelated about
pages remain prerendered and their links remain ordinary HTML navigation. The public sample
capability's metadata is anonymously discoverable through OpenAPI and MCP, while its local fixture
resolver requires a bearer token for execution on either transport.

Run `npm run example:e02` to pack the package, generate a standalone fixture lockfile, install with
`npm ci`, build, and invoke the production server. A file under `public/` remains inert bytes even
when this adapter answers POST; a JSON-looking static file is not an HTTP or MCP endpoint. Init
detection rejects protocol paths masquerading as static files and reports on-demand/server output
without an adapter. Production TLS, identity, rate limiting, deployment, and other Astro adapters
remain application/operator responsibilities.

Cloudflare's primary references are the [Wrangler configuration guide](https://developers.cloudflare.com/workers/wrangler/configuration/)
and [local development command](https://developers.cloudflare.com/workers/wrangler/commands/#dev).

## Tested on-demand and sidecar source

With Node.js 22 or newer and `npm ci` at the package root, `npm run example:e02` installs,
builds, and tests the pinned Astro on-demand fixture. Its public catalog definition is:

{{source:examples/e02-astro-on-demand-catalog/project/src/catalog.mjs#astro-album-contract}}

The E02 fixture accepts an authenticated HTTP/MCP album lookup and denies anonymous execution;
check its [standalone instructions](../examples/e02-astro-on-demand-catalog/project/README.md).
If an on-demand route is inert, verify the application already has a supported server adapter
and `prerender = false`; init does not install either.

`npm run example:e04` installs the separate Worker fixture and checks its HTTP and MCP
handlers locally. The sidecar mounts both transports from one registry:

{{source:examples/e04-worker-sidecar/project/src/index.mjs#worker-transports}}

A missing or stale `CATALOG_REVISION` yields a 503 health response; update it from E01's
ordered public catalog before retrying. The [E04 instructions](../examples/e04-worker-sidecar/project/README.md)
give the exact Wrangler local commands. Neither example deploys a service.
