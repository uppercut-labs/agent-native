# Changelog

All notable changes will be recorded here.

## 0.1.3 - 2026-10-10

- The packaged host evidence now records that Claude Code 2.1.286, in addition to Antigravity CLI, invoked the flagship E04 tool over remote MCP. It also records the verified 0.1.2 npm publication.
- The E05 example server installs its SIGINT/SIGTERM handlers before announcing `listening=`. Previously, a supervisor that signaled immediately after readiness could kill it uncleanly. The example is not part of the npm package.
- The package's own source and API are unchanged from 0.1.2.

## 0.1.2 - 2026-10-10

- Browser WebMCP tools now carry the draft's `consequentialHint` for destructive capabilities instead of MCP's `destructiveHint`, which Chrome ignored.
- Add a reproducible native Chrome 155 WebMCP probe for E06 and E01, plus cross-platform license and advisory evidence.
- E04 gains an application-owned remote CLI built on the shared flagship contract. E12 adds a server binding with HTTP parity tests.
- Add an opt-in commercial agent-host probe (`test/uan023-agent-host.mjs`). Antigravity CLI invoked the flagship E04 tool over remote MCP.
- The Codex harness handshake test now applies its 150 ms request deadline only to the hanging-handshake case, so a slow fixture start can no longer fail the auth and malformed cases.
- Add `npm run check:isolated-examples`, which installs and tests every exported example from outside the repository. CI runs it on Node 24.
- Apply the TypeScript house style to `src`. The changes are explicit annotations, `let` for mutable state with readonly types elsewhere, no non-null assertions, `assertNever` exhaustiveness, `noImplicitReturns`, and interfaces for behavior contracts. Biome no longer enforces `useConst`/`useLiteralKeys`. No exported signatures change.

## 0.1.1 - 2026-10-04

- Add isolated provider-neutral harness contracts and an owned loopback MCP bridge.
- Add a local Codex app-server adapter using managed ChatGPT sign-in, explicit model selection, cross-process resume, targeted cancellation and bounded cleanup.
- Add synthetic failure/permission tests, packed-consumer checks and an opt-in two-turn file proof. Cursor, cloud and programmatic Codex MCP configuration remain outside this release.

## 0.1.0 - 2026-10-03

### Added

- Typed capability definitions, explicit runtime bindings, a checked registry, authorization on every invocation, and input/output validation.
- Local, browser, generated CLI, HTTP/OpenAPI, and Streamable HTTP MCP adapters, with optional Astro, Next.js, and MCP Apps integration entrypoints.
- A plan-first programmatic Astro retrofit, versioned composition and migration diagnostics, grant and discovery contracts, and a read-only doctor report.
- Twelve independent example projects, source-backed guides, negative probes, and a Node 22/24 CI matrix.

### Packaging

- MIT license selected for the public source.
- Optional peer dependencies keep core/browser consumers from installing server or framework adapters.
- `prepack` builds the declared exports from a clean checkout.

### Compatibility and migration

This is a preview API at `0.1.0`. No earlier npm version exists, so there is no npm upgrade or migration path to promise. Composition across capability major versions and reviewed migrations are fixture-tested in E08; they do not imply package-level semantic version stability. See [composition and versioning](docs/composition-and-versioning.md), [compatibility](docs/compatibility.md), and [support limits](docs/support-and-limitations.md).

The 0.1.0 artifact has no package-level executable. Provider deployment, commercial MCP hosts, and native WebMCP remain outside this preview's verified scope. Release evidence records the exact source commit, tarball digest, registry state, and verified hosts separately.
