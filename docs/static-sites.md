# Static sites

Agent Native's Astro integration is an experimental browser bootstrap for static Astro output. It
injects an application-owned browser module through Astro's supported
astro:config:setup injectScript('page', ...) hook. The hook is Vite-bundled as a page module; the
application keeps ownership of its registry, browser bindings, and user interface.

Astro output must be static. The integration checks the final buildOutput, emits a diagnostic,
and fails an unsupported server-output build. It does not add an Astro server adapter, SSR route,
sidecar, or hosting configuration. Static builds use Astro's normal default output behavior. The
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

Cloudflare's primary references are the [Wrangler configuration guide](https://developers.cloudflare.com/workers/wrangler/configuration/)
and [local development command](https://developers.cloudflare.com/workers/wrangler/commands/#dev).
