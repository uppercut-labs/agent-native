# Agent Native verification and reporting reference

## Check the installed package rather than a copied repo

Use the target app's package manager. On Node.js >=22, install the published `@uppercut-labs/agent-native@1.0.1`, then only optional peers for imported adapters (`zod@4.6.x` for `/schema/zod`, official `@modelcontextprotocol/server@2.3.0` for `/mcp` or `/next` in the documented fixture). Do not assume package peers are auto-installed. The current release has no `bin` executable.

For package-maintainer verification use `npm ci`, `npm run docs:check`, `npm run check`, `npm run check:isolated-examples`, `npm run check:portability` as applicable. In a customer app, run **its own** build/type/lint/tests plus protocol probes rather than importing the package source as a workspace.

## Positive and negative cases

- **Result** — correct identity, version and runtime; actual existing handler called exactly once for a successful request; output satisfies declared schema; normal human route remains unchanged.
- **Validation** — empty/invalid/malformed input is rejected before handler. Invalid output is an error, not a successful agent result.
- **Discovery** — only intended public read visible anonymously; hidden/protected capabilities do not reveal private descriptions/schemas; direct hidden calls fail.
- **Authorization** — per-call policy applied, and protected ops (if separately authorized) recheck verified identity, grant, scope and resource owner on every call; revocation and cross-tenant denial demonstrated with disposable data.
- **HTTP** — permitted route returns correct JSON, wrong method returns correct 405, oversized/malformed request rejects, generated OpenAPI matches the route/schema. Public HTTP projection is read-only in v1.0.1.
- **MCP** — official compatible MCP SDK client obtains expected tools and invokes a real one; success under `structuredContent.result`; error path does not leak secrets, scopes or handler exceptions.
- **Static sidecar** — human static assets/prerender untouched; sidecar rejects unknown hosts/origins, route collisions and stale revisions.
- **Next/browser** — server secret sentinel absent from browser bundle; browser tool registration requires supported API and is cleaned up on navigation; fallback user-facing action works without WebMCP.
- **Deadlines** — aborted handlers cooperatively stop. If a write timed out, report uncertain completion and check state rather than blind retry.

## Evidence labels

`fixture` = controlled sample or simulated browser; `loopback` = a named local runtime/client; `real-host` = actual destination and client/version observed. Unknown or skipped requirements cannot be promoted to successful host evidence.

Report: `repository`, `commit`, `package version`, `Node/runtime/framework`, `capability identity`, `binding`, `surface`, `risk/access`, `positive proof`, `negative proof`, `human parity`, `deployment status`, `remaining actions`, `rollback`. Do not print tokens, user records or private config.
