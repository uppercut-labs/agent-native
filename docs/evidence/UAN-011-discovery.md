# UAN-011 discovery policy evidence

This bounded slice adds a shared `evaluateCapabilityDiscovery` decision and exact destructive surface exposure checks. It is applied to browser registration, MCP tool listing, and CLI help. Public reads remain the default visible catalog. Protected MCP discovery requires current token scopes and a matching live grant; the application's `discoverProtected` callback can only narrow the result. Destructive exposure additionally requires the canonical identity in the app's per-surface allowlist. The capability definition's risk metadata is unchanged.

Adapter enforcement includes the call boundary: a stale browser callback rechecks exposure, MCP rebuilds stateless tools for each request and rejects hidden direct names before a binding, and local CLI destructive invocation fails before input parsing or handler execution unless explicitly exposed. The CLI help list filters by usable local bindings or public remote routes. MCP and OpenAPI omit definitions without exactly one compatible server binding. HTTP/OpenAPI remains public-read-only.

The E07 fixture uses the official MCP client/server and its test-only verifier/store. It demonstrates edit grant discovery, Alice/Bob tenant-isolated catalogs, a delete grant that remains invisible until explicit MCP destructive exposure, refresh after revocation, and a stale direct call denied before the binding. The CLI fixture verifies generic hidden/unknown help, default public-only help, explicit protected read help, explicit destructive help, unbound filtering, and fail-closed direct destructive invocation.

## Verification

- Environment: research SSH, Node.js `v25.9.0`, npm `11.12.1`; SDK versions are pinned by package and fixture lockfiles.
- `npm run build`: passed.
- `node --test test/discovery.test.mjs test/cli.test.mjs test/browser.test.mjs test/mcp.test.mjs test/http.test.mjs`: 34 passed.
- `npm run example:e07`: 3 tests passed, standalone demo returned the public sample playlist.
- `npm run check`: passed after all code and fixture changes, including format, lint, typecheck, browser proof, root tests, and E01/E12/E05/E06/E04/E07 example checks.
- `git diff --check`: passed.

Known limits: this does not implement the E11 full runnable lab, OAuth/provider integration, production grant storage, protected HTTP routes, or deployment. The E07 JSON store is only single-process test storage. Browser host prompt behavior is not verified. Astro fixture dependency audits continue to report the previously documented advisories. E11 diagnostic-lab scope remains mapped to UAN-019/020.
