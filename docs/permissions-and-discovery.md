# Permissions and discovery

Agent Native separates metadata visibility from permission to execute. A public read capability can be listed anonymously. Protected capabilities require an explicit `discoverProtected` callback, and the executor checks authorization again for every call. A stale client tool list does not preserve access after a grant is revoked.

## Trusted identity

For remote MCP, configure `bearerAuth` with an `OAuthTokenVerifier` and an `expectedResource` from the official MCP server SDK. The SDK bearer gate validates the token before Agent Native receives `AuthInfo`. The application must map verifier-owned identity metadata to a `TrustedPrincipal` through `resolveTrustedPrincipal`; request headers and MCP client metadata are not identity sources. The principal includes issuer, subject, client ID, tenant ID, audience, token scopes and token expiry.

The library does not issue tokens, run an OAuth server, or refresh credentials. Browser sessions and CLI profiles have separate identity boundaries. Their host applications must establish a trusted principal before using the same grant policy; credentials are never shared across surfaces automatically.

## Durable grants

`GrantStorePort` supplies `find`, `save` and `revoke`. The host application owns persistent storage and the grant issuance flow. Each grant is bound to issuer, subject, client, tenant, application, audience and policy revision, with scopes, issue time, expiry and revocation time. A token is short lived proof of the current caller; a grant is the separately persisted permission. Protected execution requires both current token scopes and an unexpired, unrevoked matching grant.

`createGrantAuthorization` checks the store on every protected call. Every protected capability also requires `authorizeResource` so the application can enforce record ownership and tenant boundaries before its binding runs. Public reads need no grant store and remain available anonymously.

For protected MCP discovery, the application may use `hasGrantForScopes` inside `discoverProtected`. The older `canDiscover` hook only narrows public reads; it cannot expose protected metadata. Refresh client discovery after login, grant, scope change and revocation. Do not put protected schemas in public static manifests or a shared public cache.

The [E07 playlist fixture](../examples/e07-playlist-permissions/README.md) demonstrates official SDK bearer authentication, two tenants, persistent local grants, repeated edits, restart persistence, separate delete scope and direct denial after revocation. Its static test identities and JSON store reject production mode. The JSON store is a single-process fixture; concurrent independent processes are unsupported. Replace both with the application's real verifier and durable store before deployment. E07 checks revocation at the next store lookup in its sequential fixture; a production store's consistency and cache policy determine its actual latency.

Agent Native does not suppress confirmation prompts imposed by a browser, identity provider or MCP host. Grant reuse avoids repeated *library* consent only while identity, scopes, resource, policy and expiry remain valid.
