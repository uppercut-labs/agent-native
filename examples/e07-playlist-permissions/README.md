# E07: Playlist permissions

This disposable local example uses a real MCP client and server over loopback HTTP. It provides an anonymous public playlist read, a protected edit, and a separately scoped delete. Two fixture identities belong to different tenants.

From the repository root, run `npm run example:e07`. The check builds a local package tarball, installs the standalone project, runs its tests, then starts its public-read demo. The demo prints a JSON object containing the sample public playlist. The test checks repeated edits, grant persistence after a process restart, cross-tenant denial before mutation, wrong issuer and audience, expired token and grant, reduced token scopes, and denial after revocation using a previously visible tool name.

The example's `src/test-auth.mjs` uses static token names solely for local protocol tests. `src/grant-store.mjs` persists disposable grant records in a JSON file. Both require explicit test mode and reject `NODE_ENV=production`. The file store supports a single process, not concurrent independent writers. They are not deployment integrations. A real host must supply an official SDK token verifier backed by its identity provider, a durable grant store, a trusted principal mapper and resource ownership checks.

Grant revocation is read from the file on every protected invocation in this sequential example. No browser, commercial MCP host, provider deployment or external identity service was tested. Host confirmation prompts remain outside the library's control.
