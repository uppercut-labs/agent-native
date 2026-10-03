# Changelog

All notable changes will be recorded here. Agent Native has no published npm release.

## Unreleased

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

This is a preview API at `0.0.0`. No earlier npm version exists, so there is no npm upgrade or migration path to promise. Composition across capability major versions and reviewed migrations are fixture-tested in E08; they do not imply package-level semantic version stability. See [composition and versioning](docs/composition-and-versioning.md), [compatibility](docs/compatibility.md), and [support limits](docs/support-and-limitations.md).

The package remains `private: true`. A future release note will record the exact version, tarball digest, verified hosts, changes since this preview, and any breaking changes after release acceptance.
