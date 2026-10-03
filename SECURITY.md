# Security model

This package is an experimental source release at version `0.0.0`; no npm release or security support window is active yet. A maintainer-approved private reporting contact and disclosure process remain release gates. Please do not post credentials or exploit details in public issues.

## Identity and permission boundaries

- Remote MCP authentication uses the official SDK bearer gate and an application-supplied token verifier. The application maps verifier-owned claims to a trusted principal and verifies issuer, audience, expiry and scopes. Request headers and MCP client metadata are not trusted principal sources.
- Public reads need no grant database. Protected calls require current token scopes and a matching durable grant bound to issuer, subject, client, tenant, application, audience and policy revision. Each invocation checks expiry and revocation through the configured store.
- The application must enforce record ownership and tenant boundaries through `authorizeResource` before every protected call, including reads. Tool annotations and discovery visibility are not authorization controls.
- Browser, CLI and remote MCP credentials stay in their own host boundaries. Do not place server credentials or private capability schemas in a browser bundle or public static manifest.

## Deployment responsibilities

Use a real identity provider, durable grant store, transport security, request limits, origin/CSRF controls where browser sessions apply, and a documented revocation consistency policy. The E07 fixture contains static test identities and a single-process JSON grant file; both reject production mode. Its next-lookup revocation behavior in sequential tests does not establish the latency of another store or a cached deployment.

A timeout aborts the binding signal, but the binding must observe cancellation. Do not retry mutations without an application idempotency contract. No automatic provider provisioning, OAuth server, token cryptography or cross-surface credential sharing ships here.

See [permissions and discovery](docs/permissions-and-discovery.md) and [E07](examples/e07-playlist-permissions/README.md) for the scoped local evidence and limits.
