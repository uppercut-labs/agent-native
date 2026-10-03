# Permissions and discovery

Agent Native separates metadata visibility from permission to execute. A public read capability can be listed anonymously. The shared `evaluateCapabilityDiscovery` policy supports public reads, application-provided protected visibility checks, and exact per-surface destructive exposure. The executor checks authorization again for every call. A stale client tool list does not preserve access after a grant is revoked.

## Trusted identity

For remote MCP, configure `bearerAuth` with an `OAuthTokenVerifier` and an `expectedResource` from the official MCP server SDK. The SDK bearer gate validates the token before Agent Native receives `AuthInfo`. The application must map verifier-owned identity metadata to a `TrustedPrincipal` through `resolveTrustedPrincipal`; request headers and MCP client metadata are not identity sources. The principal includes issuer, subject, client ID, tenant ID, audience, token scopes and token expiry.

The library does not issue tokens, run an OAuth server, or refresh credentials. Browser sessions and CLI profiles have separate identity boundaries. Their host applications must establish a trusted principal before using the same grant policy; credentials are never shared across surfaces automatically.

## Durable grants

`GrantStorePort` supplies `find`, `save` and `revoke`. The host application owns persistent storage and the grant issuance flow. Each grant is bound to issuer, subject, client, tenant, application, audience and policy revision, with scopes, issue time, expiry and revocation time. A token is short lived proof of the current caller; a grant is the separately persisted permission. Protected execution requires both current token scopes and an unexpired, unrevoked matching grant.

`createGrantAuthorization` checks the store on every protected call. Every protected capability also requires `authorizeResource` so the application can enforce record ownership and tenant boundaries before its binding runs. Public reads need no grant store and remain available anonymously.

For protected MCP discovery, the application may use `hasGrantForScopes` inside `discoverProtected`. The older `canDiscover` hook only narrows public reads; it cannot expose protected metadata. `evaluateCapabilityDiscovery` returns only a visibility decision and safe denial reason; adapters do not serialize private descriptions or schemas when a capability is hidden. Refresh browser registration or remote tool discovery after login, grant, scope change and revocation. Do not put protected schemas in public static manifests or a shared public cache.

Destructive visibility also requires an explicit per-app surface allowlist, such as `surfaceExposure: { mcp: { destructive: ['account:delete@1'] } }`. The canonical identity must be listed for that surface, and the current authorization check must still pass. This configuration does not change the domain capability's risk metadata. Browser and CLI use `browser` and `cli` keys respectively. The HTTP adapter in this package remains public-read-only and emits only public read routes in OpenAPI.

The [E07 playlist fixture](https://github.com/uppercut-labs/agent-native/blob/main/examples/e07-playlist-permissions/README.md) demonstrates official SDK bearer authentication, two tenants, persistent local grants, repeated edits, restart persistence, separate delete scope and direct denial after revocation. Its static test identities and JSON store reject production mode. The JSON store is a single-process fixture; concurrent independent processes are unsupported. Replace both with the application's real verifier and durable store before deployment. E07 checks revocation at the next store lookup in its sequential fixture; a production store's consistency and cache policy determine its actual latency.

Agent Native does not suppress confirmation prompts imposed by a browser, identity provider or MCP host. Grant reuse avoids repeated *library* consent only while identity, scopes, resource, policy and expiry remain valid.

## Surface policy

The shared `evaluateCapabilityDiscovery` decision supports public reads, application-provided protected visibility checks, and exact per-surface destructive exposure. For MCP, the adapter first requires current token scopes and a matching unexpired, unrevoked grant; `discoverProtected` can only narrow that set. A stale client tool list does not preserve access after grant revocation.

Destructive capabilities also require an exact per-app surface allowlist, such as `surfaceExposure: { mcp: { destructive: ['account:delete@1'] } }`. The current authorization check must still pass, and destructive exposure is rechecked at the adapter call boundary. This configuration does not change domain risk metadata. Browser and CLI use `browser` and `cli` keys. HTTP/OpenAPI remains public-read-only and lists only capabilities with a unique server binding.

CLI help filters by usable local bindings or public remote routes. Hidden or unavailable identities receive a generic explanation. Applications should close `canDiscover` over a trusted caller from their authentication boundary, never infer identity from command arguments or user-provided text. Refresh browser sync and remote tool listing after login, grant, scope change and revocation.

## Verify revocation locally

With Node.js 22 or newer, run `npm ci` and `npm run example:e07` from the package root.
The single-process fixture persists grants and revokes an existing ID in its local JSON store:

<!-- source:examples/e07-playlist-permissions/project/src/grant-store.mjs#revoke-grant -->
~~~js
async revoke(grantId, revokedAt) {
  return await this.#withWriteLock(async () => {
    const grants = await this.#read();
    const grant = grants.find((entry) => entry.grantId === grantId);
    if (!grant || grant.revokedAt !== null) return false;
    grant.revokedAt = revokedAt;
    await this.#write(grants);
    return true;
  });
}
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e07-playlist-permissions/project/src/grant-store.mjs#L56)
<!-- /source -->

The negative test proves that a revoked ID cannot be saved again and that the next protected
call is denied. If the fixture refuses to start in production mode, remove
`NODE_ENV=production` and use the documented local test mode; this JSON store intentionally
rejects production use. See [E07 setup and cleanup](https://github.com/uppercut-labs/agent-native/blob/main/examples/e07-playlist-permissions/README.md).
