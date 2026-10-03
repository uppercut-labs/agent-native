# UAN-008 Cloudflare Worker sidecar evidence

## Scope

E04 is a separate Worker sidecar for E01's static Astro catalog. The exporter copies E01's
canonical public album data, shared capability contract, and sidecar diagnostics into an isolated
Worker fixture. Browser and Worker bind the same definition, schema, lookup function, and data;
parity tests verify contract identity and input/output schemas. A SHA-256 revision is derived from
JSON-serialized ordered album records, and the E01 test recomputes it. Wrangler configuration is
checked against the shared revision.

The Worker delegates HTTP/OpenAPI and MCP to package adapters. It uses Web Request/Response APIs,
bounded adapter bodies/deadlines, explicit SIDECAR_HOST and ALLOWED_ORIGIN configuration, Host and
browser-Origin checks, and exact ACAO for the configured origin for browser health/HTTP diagnostics. Cross-origin browser MCP is not claimed; the official MCP client fixture sends no browser Origin. It exposes only the public-read
album capability.

## Verification

Run npm run example:e04 from the repository root. The exporter installs the standalone fixture,
runs 9 diagnostic/config/contract tests, then runs Wrangler locally on workerd. Local requests
exercise matching catalog health, OpenAPI, an HTTP invocation, exact-origin ACAO/preflight, denied
Origin and Host, and an official MCP SDK client discovery/call. The client records negotiated MCP
protocol 2025-11-25. The HTTP and MCP success paths are real local workerd exchanges; the sidecar
origin, missing same-origin route, missing binding, and revision mismatch classifier cases are
simulated/unit requests.

The same command runs Wrangler deploy --dry-run --outdir .worker-bundle. It scans all emitted JS
files for Node builtin import/require specifiers and verifies the Wrangler config does not enable
nodejs_compat. The dry-run builds and inspects only; it does not deploy. Operators can start local workerd with npx wrangler dev --local. A later, separately approved release would use npx wrangler deploy only after setting the actual host/origin/revision values and Cloudflare account; no live deployment was performed.

E01's before-state fixture and integrated site both build as Astro static output with no server
adapter. Its generated album page carries the shared revision. Browser sidecar diagnostics refresh
after Astro ClientRouter navigation and Window pageshow, deduplicate installation, and probe the
same-origin /mcp path only when same-origin routing is explicitly configured.

## Limits

Evidence is local workerd execution. No Cloudflare production deploy, account provisioning, paid
resource, DNS change, custom host, real browser, or production CORS behavior was performed or
verified. The fixture's SIDECAR_HOST, ALLOWED_ORIGIN, and public Astro environment values are local
examples and must be replaced for an operator's hosts. A sidecar URL does not create a same-origin
/mcp route. Cross-origin browser MCP is not claimed; the official MCP SDK fixture is server-side
and sends no browser Origin.

The SHA-256 revision is exposed in the static page and Worker health response. It is checked from
ordered public album JSON in tests rather than computed dynamically in browser runtime. These
diagnostic tests are simulated; the HTTP and MCP exchange against local workerd is real.

The Astro 7.3.5 transitive http-cache-semantics@4.2.0 advisory and release gate documented in
UAN-007 evidence remain unresolved. Astro is not bundled in the core tarball, but Astro consumers
may install the affected dependency.

## References

- Cloudflare Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare local development: https://developers.cloudflare.com/workers/wrangler/commands/#dev
