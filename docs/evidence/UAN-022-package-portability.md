# UAN-022 package installation portability (partial)

Environment: research macOS host, Node 24.18.0, npm from that Node installation, local package version 0.0.0. The clean source baseline was commit cf499a8. These are fresh npm tarball installations with install scripts disabled for the isolated size comparison; representative examples use their normal standalone npm-ci harness.

## Measured baseline and optional-peer change

| Fresh consumer | Package tarball | Installed node_modules disk use | MCP server | Zod |
| --- | ---: | ---: | --- | --- |
| Baseline core/browser, hard dependencies | 115,834 bytes | 16,876 KiB | yes | yes |
| Changed core/browser, no peer selected | 115,848 bytes | 764 KiB | no | no |
| Changed browser with explicit Zod | same package | 9,000 KiB | no | yes |
| Changed MCP with explicit server SDK | same package | 16,876 KiB | yes | yes |

The changed core/browser installed tree contained 503,177 file bytes before this evidence page was added. The disk-use drop against the original baseline is about 95.5 percent. The npm tarball size is nearly unchanged because exports remain in one umbrella package; this result measures dependency installation rather than proving a smaller client bundle.

The new npm run check:portability builds and packs the package, checks all exported files are present, installs a fresh core/browser consumer, imports both entrypoints, verifies that all optional peers remain absent, and caps installed file bytes at 2,000,000 (about four times the measured 503,177-byte baseline). A later run including the check script itself reported 115,864 tarball bytes and 503,276 installed file bytes.

## Packed examples

- E01 static Astro: 12 tests and static build passed; installed Zod for its schema and no MCP server.
- E02 on-demand Astro: standalone live HTTP/MCP verification passed with an explicit MCP server.
- E03 Next 16.3.8: two tests, official MCP route smoke, production build and browser secret boundary passed after declaring the MCP server directly.
- E04 Worker sidecar: nine fixture tests, Wrangler dry-run bundle scan, and live official MCP client roundtrip passed after `sdkSchema()` began giving the Worker validator a mutable JSON copy. The first integrated CI run and the untouched cf499a8 research clone had returned HTTP 500 because the validator tried to annotate a frozen schema. Node 22/24 CI after this repair remains the integration gate.
- E05 Node/Hono CLI: 12 tests, local/remote parity and CLI start passed with an explicit MCP server.
- E06 browser-only: one test and Vite build passed; the emitted JS asset measured 86.17 kB / 25.78 kB gzip and the installed tree contained Zod but no MCP server.
- E08 contract pack: nine tests and the independent demo passed; no MCP server or Zod installed.

Node 24 typecheck and build, scoped Biome format, git diff check and production npm audit (zero reported vulnerabilities) passed. No full local root test suite was repeated for this slice.

## Packed CLI and direct-license inventory (2026-10-03)

The same fresh core/browser consumer now runs the package's CLI adapter in an application-owned process with no optional peers. A small fixture declares a read-only `smoke:greet@1` capability using the core schema port, then calls `runCapabilityCli`. On research macOS Node 24.18.0, the packed check passed `--help`, `--version`, a successful local typed-flag invocation, and an invalid-input exit-2 envelope. The local invocation measured about 30 ms wall time including Node process startup on this host; it is an observation, not a cross-platform budget. The package is a library with no `bin` entry, so there is no global `agent-native` command to test. E05 remains the representative application-owned local/remote CLI with Hono and explicit MCP/Zod peers.

The check reported about 128 KB of tarball data and 555 KB of installed files for this fresh consumer; exact bytes change as included documentation changes. The installed package has zero hard runtime dependencies; MCP server, MCP Apps, Astro and Zod remained absent. Exact direct license metadata from the npm registry for this candidate's pinned optional peers:

| Package | Version | Registry license |
| --- | --- | --- |
| @uppercut-labs/agent-native | 0.0.0 local tarball | MIT (`LICENSE` in tarball) |
| @modelcontextprotocol/server | 2.3.0 | Apache-2.0 |
| @modelcontextprotocol/ext-apps | 2.0.3 | MIT |
| astro | 7.3.5 tested; peer range 7.x | MIT |
| zod | 4.6.5 | MIT |

This is a direct-package inventory, not a license review of every transitive dependency. The core/browser consumer installs no optional peer, so its runtime license set is the Agent Native tarball. Applications selecting framework/MCP/Zod integrations must inventory their actual resolved dependency tree.

## Windows packed CLI smoke (2026-10-03)

A tarball packed from canonical `72dab23` on research was copied to a fresh temporary Windows project whose path contains spaces (`Agent Native Windows CLI Smoke`). The project had its own `package.json` and npm used an explicit `--prefix` with `--omit=optional --ignore-scripts`. On Windows Node 24.18.0/npm 12.1.0, the 129,299-byte tarball installed 125 package files totaling 557,803 bytes. MCP, Astro and Zod optional peers were absent. Module resolution pointed inside that temporary project's `node_modules`.

The application-owned packed CLI printed help and version, returned a successful `smoke:greet@1` local invocation (`Hello, Windows!`, exit 0), and returned a structured `invalid-input` envelope with exit 2 for a missing required argument. This is a Windows packed-library CLI adapter check, not a global `bin` command or a hosted remote CLI claim. The first attempted installation lacked a local manifest and npm selected the home project; the added dependency was uninstalled, its manifest and lockfile were verified free of Agent Native, and the prior `graceful-fs` package was present again. The reported result is from the subsequent explicitly isolated project.

## Remaining qualification

Windows packed CLI help/version/local invocation/invalid-input passed in an isolated path with spaces. Linux packed CLI will run in the Node 22/24 CI matrix once this change is integrated; the result must be checked there. Cold doctor timing, independent client bundle budgets, transitive dependency license review and outside-repository npm release installation remain open. One macOS timing sample is insufficient to set cross-platform performance thresholds. No npm publication or commercial host support is claimed.
