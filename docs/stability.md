# Stability and versioning

From 1.0.0, Agent Native follows [semantic versioning](https://semver.org/) for its **stable** entry points. **Experimental** entry points are published and documented, but may change in a minor release. Each change appears in the [changelog](https://github.com/uppercut-labs/agent-native/blob/main/CHANGELOG.md) with a migration note.

## Entry points

| Import specifier | Class | Covers |
| --- | --- | --- |
| `@uppercut-labs/agent-native` | Stable | Definitions, bindings, registry, executor, composition, diagnostics, discovery, grants |
| `@uppercut-labs/agent-native/contracts` | Stable | `defineCapability`, identities, risk and access |
| `@uppercut-labs/agent-native/registry` | Stable | `bindCapability`, `createCapabilityRegistry` |
| `@uppercut-labs/agent-native/executor` | Stable | `executeCapability`, callers, authorization port, results |
| `@uppercut-labs/agent-native/composition` | Stable | Capability packs, aliases, migrations, surface names |
| `@uppercut-labs/agent-native/diagnostics` | Stable | Diagnostic observations |
| `@uppercut-labs/agent-native/auth` | Stable | Trusted principals, grant store port, grant authorization |
| `@uppercut-labs/agent-native/schema/zod` | Stable | `fromZod` |
| `@uppercut-labs/agent-native/http` | Stable | Public-read HTTP and OpenAPI |
| `@uppercut-labs/agent-native/mcp` | Stable | Remote MCP over Streamable HTTP |
| `@uppercut-labs/agent-native/cli` | Stable | Application-owned CLI runner and result schema |
| `@uppercut-labs/agent-native/browser` | Experimental | WebMCP follows a draft browser API |
| `@uppercut-labs/agent-native/mcp-apps` | Experimental | MCP Apps extension; no commercial host rendering is verified |
| `@uppercut-labs/agent-native/astro` | Experimental | Framework integration tied to tested Astro releases |
| `@uppercut-labs/agent-native/next` | Experimental | Framework integration tied to tested Next releases |
| `@uppercut-labs/agent-native/next/browser` | Experimental | Next browser registration |
| `@uppercut-labs/agent-native/init` | Experimental | Narrow existing-project init |
| `@uppercut-labs/agent-native/doctor` | Experimental | Diagnostics checks and report format |
| `@uppercut-labs/agent-native/harness` | Experimental | Provider-neutral harness contracts |
| `@uppercut-labs/agent-native/harness/mcp-bridge` | Experimental | Loopback MCP bridge |
| `@uppercut-labs/agent-native/harness/codex` | Experimental | Local Codex app-server adapter |

Paths not listed above, such as `dist/` files, are internal and may change at any time. The package's `exports` map blocks them.

## What counts as a breaking change to a stable entry point

The following need a new major version:

- Removing or renaming an export, or making a required parameter or option out of an optional one.
- Narrowing an accepted input type or widening a returned type in a way that breaks existing callers.
- Changing documented behavior a caller can rely on: execution order (input validation, then authorization, then the binding, then output validation), failure reasons, MCP tool naming by default, discovery and authorization outcomes, the result shape, and the HTTP routes and OpenAPI output for public reads.
- Dropping support for a Node.js major line, or for a tested optional peer version line, listed in [installation](installation.md).

The following can ship in a minor version: new exports, new optional options, new fields on returned objects, new failure reasons behind an existing generic client message, and support for new peer or runtime versions. Patch versions fix defects without changing documented behavior. A security fix may tighten behavior in a minor or patch release; the changelog marks it.

Deprecated stable APIs keep working for at least one minor release, and until the next major, with a changelog note naming the replacement.

## How the guarantee is enforced

`npm run check:api` compares the declaration files reachable from every stable entry point with `api/stable-api.txt`. Any change fails the check until the baseline is regenerated with `node scripts/check-api.mjs --update` and the change is reviewed against this policy. Comment-only edits do not count. The check runs in CI as part of `npm run check`.

## Runtime and peer support

The package requires Node.js 22 or newer. Optional peers are pinned to the versions the test suite exercises; see [installation](installation.md). Widening a peer range to a newly tested line is a minor change.
