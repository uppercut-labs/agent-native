# Changelog

All notable changes will be recorded here.

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
