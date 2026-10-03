# Uppercut Agent Native

Uppercut Agent Native is an experimental package for typed capability contracts with local,
HTTP, CLI, MCP, browser, and Astro static-site surfaces. The package working name is
`@uppercut-labs/agent-native`; its manifest remains `private: true` at version `0.0.0`, so it
cannot be published accidentally.

## Current scope

UAN-001 established the strict TypeScript baseline, Zod adapter, JSON Schema projection checks,
and stable diagnostic observations. UAN-002 adds immutable capability definitions, explicit
runtime bindings, a checked registry, per-invocation authorization, and shared input/output
validation. E01 exercises shared album lookup and a static Astro site integration; E12 is a
shared unit-converter example; E05 covers local and HTTP execution through the CLI. UAN-008 adds E04, a locally verified Worker sidecar for the same E01 contract while the Astro site remains static.

Run `npm run example:e01`, `npm run example:e12`, or `npm run example:e05` to build and pack the
package, install it independently into each example, and run its tests and runnable surface. E01
also verifies a pre-existing multi-page static Astro fixture before and after integration. E04 checks a local workerd HTTP/OpenAPI roundtrip and official MCP client exchange; it does not deploy or configure DNS.

The root, `./contracts`, `./registry`, and `./executor` entrypoints use only portable core modules.
They do not import Zod, Node, DOM, framework, provider, or server modules. `npm run check` compiles
and scans browser output against a fake server-secret sentinel. This is a boundary regression
check, not proof of compatibility with any real browser, client, or host.

Every execution requires an `AuthorizationPort`; there is no implicit allow-all path. The executor
checks input, authorization, handler, and output in that order. Runtime matching is exact, and
multiple matching bindings require a `bindingId`. Durable grants, identity integration, and
transports remain outside this slice. See [the capability and binding guide](docs/capabilities-and-bindings.md)
for the frozen signatures and limitations.

## HTTP and OpenAPI

The separate `@uppercut-labs/agent-native/http` entrypoint provides a framework-neutral Web
Request/Response handler. It exposes deterministic POST invocation routes only for explicit public
read capabilities, generates OpenAPI 3.1 from those contracts, and serves protocol health evidence.
Protected capability schemas and routes are omitted from this initial HTTP projection. See
[the HTTP guide](docs/http.md) for response mappings, body/deadline limits, and integration boundaries.

## Browser tools

The isolated `@uppercut-labs/agent-native/browser` entrypoint feature-detects the current WebMCP
document.modelContext API and owns registrations with an AbortSignal. It projects only definitions
with browser bindings; public reads are exposed by default, while protected tools require an explicit
projection policy and are still authorized on every call. The WebMCP API fixture is simulated; no
native browser host is claimed. See [the browser guide](docs/browser.md).

## Astro static sites

The isolated `@uppercut-labs/agent-native/astro` integration injects an application-owned browser
entry with Astro's page-script hook, verifies static output, and installs no server adapter. E01 is
pinned to Astro 7.3.5 and retains its existing pages, assets, and navigation. WebMCP remains
feature-detected and optional; the human catalog search works without it. See
[static-site guidance](docs/static-sites.md), [framework support](docs/frameworks.md), and
[UAN-007 evidence](docs/evidence/UAN-007-astro.md).

## Remote MCP

The isolated `@uppercut-labs/agent-native/mcp` entrypoint uses the official MCP server SDK over
Streamable HTTP. It exposes only explicitly public read capabilities, filters discovery per request,
and reauthorizes every call through the shared executor. Results place the canonical value under
`structuredContent.result`. See [the MCP guide](docs/mcp.md) and
[fixture-tested compatibility](docs/compatibility.md). The fixture covers the official SDK client
and server packages at version 2.3.0 and the negotiated protocol version 2025-11-25; this is not a
claim that every commercial client or deployment host is supported.

## Generated CLI

The separate `@uppercut-labs/agent-native/cli` runner entrypoint builds help and typed field flags from registry schemas. Calls select `--mode local|remote` explicitly; remote calls also select a configured credential profile and use a bounded HTTP request. Invocations write one `uan.cli-result/v1` JSON envelope to stdout and redacted target/failure diagnostics to stderr. No package-level `bin` command ships yet; applications expose the runner with their own registry. See [the CLI guide](docs/cli.md) and the installed E05/E12 examples.

## Development

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run example:e01
npm run example:e12
npm run example:e05
npm run check
```

The schema spike checks album lookup and unit conversion input/output shapes with Zod 4, then
validates exported draft-2020-12 schemas independently with Ajv. JSON Schema projection throws for
transforms that cannot be represented faithfully. The official MCP server SDK is a runtime
dependency of the isolated MCP adapter; the official MCP client SDK is pinned for the local protocol
fixture only. See [UAN-008 sidecar evidence](docs/evidence/UAN-008-worker-sidecar.md) for host/origin controls, revision matching, and local-only limits.

## Status

Not published. MIT is the selected license. UAN-002 local acceptance and limitations are in
`evidence/UAN-002.md`; pinned tool versions and upstream references are in `VERSION-EVIDENCE.md`.
