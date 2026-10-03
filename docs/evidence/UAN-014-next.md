# UAN-014 Next.js integration evidence (draft)

## Scope

The preserved baseline is `examples/e03-next-reading-list/site-before`. The generated after-state
comes from `examples/e03-next-reading-list/project` through `npm run example:e03`; the exporter packs
the local package, pins the tarball in the generated manifest, creates a lockfile, installs with
`npm ci`, tests, and builds Next 16.3.8 for the Node runtime.

The isolated `@uppercut-labs/agent-native/next` entrypoint exposes App Router-compatible method
handlers around the existing HTTP and official MCP adapters. `next/browser` is separate and imports
only the browser adapter and core registry types. Neither core nor the Astro entrypoint imports Next.
The route modules explicitly select `runtime = 'nodejs'`.

## Acceptance evidence

- `reading:catalog.list@1` is defined once and registered with separate server and browser bindings.
  HTTP and MCP use the same server registry and shared executor; supported WebMCP uses the same
  definition through the browser registry.
- The official MCP 2.3.0 client connects over a real local HTTP socket, lists the catalog tool, and
  calls it. The Next HTTP route invokes the same catalog and returns four public fake records.
- The original `/api/catalog`, `/api/saved-list`, layout content, and fixture identity boundary are
  retained. Tests keep the cross-user saved-list mutation denial and forged-identity denial.
- Production browser source maps are enabled. The boundary script requires the fake server sentinel
  in emitted server JavaScript and rejects it in every browser JavaScript and source-map artifact.
- The browser bootstrap is feature-detected and resynced from a client component on pathname changes.
  Package tests simulate two syncs and prove stale registrations are aborted. Ordinary page content
  remains usable when WebMCP is absent.
- Next init detection reads package/config/directory evidence without importing application code.
  An existing App Router `/mcp` route yields a same-origin plan conflict with an empty proposed-file
  list; the test verifies existing auth and layout bytes are unchanged.

## Verification record

Local verification on 2026-10-02 produced:

- `npm run format:check`: passed after generated export/build output was removed.
- `npm run lint`: passed with repository-existing informational diagnostics and warnings; no errors.
- `npm run typecheck`: passed all three TypeScript projects.
- `npm run build:browser-proof && npm test`: passed 76 tests after creating the browser-proof
  output required by the existing sentinel test.
- `npm run example:e03`: passed two saved-list authorization tests, HTTP route invocation, an
  official MCP client exchange, Next 16.3.8 production build, and artifact inspection. The sentinel
  occurred in one server artifact and no browser artifacts among 20 JavaScript/maps, including nine
  source maps.
- `npm_config_cache=/private/tmp/uan014-npm-cache npm pack --dry-run --json`: passed with 96 files;
  the first attempt using the user cache was blocked by root-owned cache entries.

## Limits

Evidence is local to Node.js, Next 16.3.8, the production compiler, a loopback HTTP socket, the
official MCP client, and a simulated WebMCP API. No provider deployment, Edge runtime, OAuth flow,
durable multi-process store, commercial MCP host, physical browser, or native browser agent was
tested. The fixture's sessions, catalog, and sentinel are public fake data. Generated `.next`,
export, tarball, and installed dependency output are ignored and are not source evidence.
