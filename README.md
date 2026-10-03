# Uppercut Agent Native

Uppercut Agent Native is an early implementation of typed capability contracts with local and HTTP execution. The package working name is `@uppercut-labs/agent-native`; its manifest remains
`private: true` at version `0.0.0`, so it cannot be published accidentally.

## Current scope

UAN-001 established the strict TypeScript baseline, Zod adapter, JSON Schema projection checks,
and stable diagnostic observations. UAN-002 adds immutable capability definitions, explicit
runtime bindings, a checked registry, per-invocation authorization, and shared input/output
validation. E01 and E12 are independently installable Node examples of this execution slice; E05 is a fresh-install CLI fixture covering local and HTTP execution parity.

Run `npm run example:e01`, `npm run example:e12`, or `npm run example:e05` to export each example with the package tarball,
generate its lockfile, install it independently, and run its tests and CLI. E01 proves the album
domain slice only; it is not the Astro retrofit. E12 returns `30.48 cm` for its fixed fixture through the versioned generated CLI.

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
transforms that cannot be represented faithfully. The official MCP server SDK is a development-
only dependency for an upstream `any` to `unknown` validation-boundary fixture; the contract core
does not import it. No protocol-conformance claim follows from installing that SDK.

## Status

Not published. MIT is the selected license. The UAN-002 local acceptance and limitations are in
`evidence/UAN-002.md`; pinned tool versions and upstream references are in `VERSION-EVIDENCE.md`.
