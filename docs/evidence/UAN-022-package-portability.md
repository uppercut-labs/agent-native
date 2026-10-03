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

## Remaining qualification

Windows and Linux CLI runs, cold doctor/invocation timing, independent client bundle budgets, dependency license inventory and outside-repository npm release installation remain open. One macOS snapshot is insufficient to set cross-platform performance thresholds. No npm publication or commercial host support is claimed.
