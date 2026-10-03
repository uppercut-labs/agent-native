# UAN-010: Trusted authentication and durable grants

## Scope

This slice adds `TrustedPrincipal`, `GrantStorePort`, `createGrantAuthorization`, `hasGrantForScopes` and `executionCallerForPrincipal` to the portable root API. The MCP adapter uses the official server SDK bearer gate when configured, maps verifier-owned identity through a host callback, and permits protected discovery only through an explicit callback. The E07 disposable playlist fixture supplies a local JSON grant store and static test verifier. It is not a production identity provider or grant database.

## Local evidence

On `research` with Node 25.9.0 and npm 11.12.1, `npm run check` completed successfully. That command includes format, lint, TypeScript checks, browser import boundary, root tests and standalone E01/E12/E05/E06/E04/E07 checks. `npm run example:e07` built and packed the package, installed a standalone project from the local tarball, ran its official SDK client/server tests, and printed the public sample playlist from its runnable demo.

Auth tests deny reduced token scopes, mismatched caller, expired principal or grant, revoked grant, wrong audience and cross-tenant record access before a binding runs. E07 tests anonymous public discovery, hidden protected tools before a grant, repeated edit calls, grant reuse after process restart, separate delete scope, two tenants, wrong issuer/audience/expiry, and a stale previously visible tool name after revocation. An independent review identified a protected-read object-policy gap and a concurrent fixture write race; both were corrected before completion.

## Boundaries

The fixture's static test tokens, principal mapper and JSON file store reject production mode. The JSON store supports a single process with serialized writes; it is not a cross-process database. E07 reads grant state for each protected call and checks revocation at the next sequential lookup. A production provider must define its own store consistency, revocation latency, identity verification, resource ownership and safe grant issuance. The library does not issue OAuth tokens, implement token cryptography, refresh host sessions, or suppress host confirmation prompts.

No external identity provider, provider deployment, native WebMCP browser, commercial MCP host, or real user consent flow was verified here. Astro's transitive `http-cache-semantics` advisory remains a release gate. The package is still `private: true` at `0.0.0` and is not published to npmjs.com.
