# Real integration: Domain Expansion

Checked 2026-10-11. Domain Expansion is an existing first-party application with publicly available [source](https://github.com/uppercut-labs/domain-expansion). It integrates Agent Native with authenticated remote MCP in a deployed application; the production endpoint, deployment configuration, and operator credentials are deliberately omitted from this SDK-level evidence. This was the first integration outside the repository's fixtures.

## What it exercises

- Five protected application capabilities projected through MCP; a separate destructive operation intentionally has no MCP exposure.
- The application supplies its own bearer authentication, trusted-principal resolution, persisted grant checks, and per-resource authorization via `bearerAuth`, `resolveTrustedPrincipal`, `GrantStorePort` and `authorizeResource`; this note contains no token, identity, grant record or sensitive configuration.
- Bindings call application-owned services so validation, revisions, idempotency and rate limits remain shared with the application's existing interfaces.

## Results

| Check | Where | Result |
| --- | --- | --- |
| Official SDK client discovery and calls | Deployed | Pass; protocol 2025-11-25 |
| Typed outcomes: found and not found, stale revision, duplicate name | Deployed | Pass |
| Invalid input rejected before the binding | Deployed | Pass |
| No token: 401 with `WWW-Authenticate: Bearer`; bad token: 401; foreign Origin: 403 (application check) | Deployed | Pass |
| A read-only token lists only read tools; a revoked token is refused on the next call | Local, official SDK | Pass |
| Delete neither listed nor callable | Deployed | Pass |
| Real host | Deployed | Claude Code 2.1.285 listed the tools and read real data without changes |
| Rollback to the previous Worker version and back | Deployed | Pass |
| Other MCP hosts; MCP OAuth | — | Not tested |

## Findings fixed for 1.0

The integration ran on 0.1.3, and these changes came out of it:

- Bindings receive `context.caller`.
- Protected-only servers challenge requests that have no token.
- The adapter has `onToolFailure` and `toolName` options.
- The Zod peer accepts the 4.6.x patch line.
- The MCP guide documents the Workers stream lifecycle.

The application was then rebuilt on the packed 1.0 candidate. Its MCP tests and its Worker smoke test under workerd passed. See [upgrading from 0.1.x](../upgrading-to-1.0.md).
