# UAN-020 negative security fixture evidence

This slice adds deterministic local fixtures for E07 authorization, identity, and MCP App
resource behavior. Tests use official SDK clients over loopback HTTP. No production identity provider,
remote MCP host, browser sandbox, or production network service is exercised.

## Demonstrated behavior

- E07 rechecks a durable grant on the next same-client call. After delete access is revoked, the tool
  disappears from discovery, direct invocation is denied, the target playlist survives, and the other
  tenant's playlist remains unchanged.
- Wrong-issuer, wrong-audience, expired, low-scope, malformed, oversized, cross-tenant, hidden-tool,
  and revoked calls do not mutate playlist state. Negative responses do not reflect the fixture token
  or adversarial payload sentinels.
- Two tenants have independent grants and record ownership. Revoking Alice's delete grant does not
  change Bob's playlist or grant.
- MCP App registration rejects non-`ui://` schemes, traversal segments, undeclared capability IDs,
  protocol-relative scripts, and external CSS origins. A legitimate bundled resource completes an
  SDK list/read roundtrip with `text/html;profile=mcp-app`.
- MCP App resources inherit capability discovery. An anonymous client cannot list or directly read a
  protected resource. An authenticated client can read it while its grant is live; after revocation,
  the next list/read in that same client session is denied without executing the protected binding.
- The E07 process refuses empty or missing explicit persistence paths. A canary starts it in an empty temporary working
  directory and verifies failure creates no default files. This is an E07-only no-default-mutation
  claim, not evidence about CLI init or doctor behavior.

## Reproduction

Run from the repository root with the checked-in dependency set:

```sh
npm run build
node --test test/mcp.test.mjs test/mcp-apps-security.test.mjs
npm run example:e07
npm run example:e09
npx biome format src/mcp-apps.ts test/mcp.test.mjs test/mcp-apps-security.test.mjs examples/e07-playlist-permissions/project/src/server.mjs examples/e07-playlist-permissions/project/test/e07.test.mjs
npx biome lint src/mcp-apps.ts test/mcp.test.mjs test/mcp-apps-security.test.mjs examples/e07-playlist-permissions/project/src/server.mjs examples/e07-playlist-permissions/project/test/e07.test.mjs
npm run typecheck
git diff --check
```

Record the exact local command results in the UAN-020 handoff; this note does not treat commands as
passing until they have run in the integration worktree.

## Limits and integration dependencies

- Static token names and the JSON stores exist only in explicit E07 test mode. They are not a JWT
  implementation, production credential, cross-process lock, or production persistence design.
- The MCP transport is loopback HTTP using official SDK clients. No commercial host, iframe origin,
  CSP enforcement engine, OAuth server, intermediary cache, or concurrent distributed session was tested.
  Deployed cache-control and cross-surface cache isolation remain open.
- UAN-018 owns CLI, HTTP, and contract integration. UAN-019 owns doctor integration. This slice makes
  no claim about those surfaces and does not edit their files.
- The no-default-mutation canary is intentionally limited to E07's explicit local persistence paths.
  UAN-018/UAN-019 must integrate their own init/doctor mutation evidence before a cross-surface claim.

## Isolated research verification

At public base 0257a9b, the isolated research checkout passed Node 24 typecheck and build, the focused MCP test file (13/13), the MCP App security regressions (2/2), standalone E07 (4/4), and standalone E09 (3/3). Scoped Biome format and lint passed; lint emitted only existing template-literal style suggestions. This is local fixture evidence, not canonical CI or real-host verification.

The first standalone E07 run failed 3/4 because the fixture accepted empty persistence paths and its new canary waited for a process that had started. The fixture now rejects empty paths and the canary has a three-second deadline. The second standalone E07 run passed 4/4. The MCP App validator now checks URL-bearing attributes across tags, rejects entity-bearing URL values and external candidates in srcset, and rejects meta refresh directives while allowing bundled relative resources. The focused regressions include unquoted script/image URLs, character references, mixed srcset, form/base URLs, quoted-attribute delimiters, CSS URL/import/escape attempts, and caller mutation after validation. The validator returns frozen copies of the reviewed resource fields. Host CSP enforcement remains a separate unverified boundary.
