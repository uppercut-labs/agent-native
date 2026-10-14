# Agent Native surface-selection reference

Read this reference when selecting a runtime, routing mode or server adapter. The skill itself does not require this extra context for a small local-only question.

| Existing application | First viable integration | What the app owns | Checked guide/fixture |
| --- | --- | --- | --- |
| Server-side Node app or Hono | `createHttpHandler` (public reads) and optional `createMcpHandler` mounted on existing server | HTTPS/reverse proxy, real app auth, host/origin/rate limits, routes | `docs/http.md`, `docs/mcp.md`; E05 |
| Next.js App Router | Node runtime route factories from `/next`, app-owned registry + app routes | `server-only` secrets/auth, route ownership, server deploy | `docs/next.md`; E03, pinned Next 16.3.8 |
| Astro on-demand | App-owned endpoints with official Node adapter | adapter/hosting setup, static page prerender boundaries | `docs/static-sites.md`; E02, Astro 7.3.5 |
| Astro static with remote tools | **separate Worker or equivalent sidecar** for HTTP/MCP; browser entry optional | CORS, Host/Origin allowlist, revision parity, DNS/routing, secrets | `docs/static-sites.md`; E01+E04 |
| Any ordinary browser page | optional `/browser` WebMCP adapter with fallback human UI | safe browser-target bindings, registration lifecycle, local auth | `docs/browser.md`; E06; opt-in Chrome 155 evidence only |
| CLI user-facing automation | `/cli` application-owned runner | binary/wrapper, credentials/config, local or explicit remote mode | `docs/cli.md`; E05/E12 |
| Protected or destructive remote tools | MCP with official SDK verifier and app-grant policy, not HTTP public-read projection | trusted principal, tenant/resource authorization, persistent grants, revocation, idempotency, consent | `docs/permissions-and-discovery.md`; E07 fixture |

**Default path:** existing server → actual read-only application operation → shared capability registry → optional HTTP+MCP projection → one real protocol call and denied/invalid probe.

**Project questions to answer from evidence (not assumptions):** Is the site purely static? Does a server already own authenticated operations? Is its runtime compatible with optional peers? Is there a preexisting `/mcp` or `/agent-native/v1` route? Are data items already guarded by user/tenant? Do existing human pages call the same function? Is deployment requested and authorized?

**Unsupported assertions:** no automatic one-command all-framework retrofit, no guaranteed commercial MCP Apps rendering, no default-enabled shipping browser WebMCP, no `agent-native init` executable, and no application identity/grant issuance service supplied by this package.
