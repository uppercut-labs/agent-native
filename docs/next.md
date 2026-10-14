# Next.js App Router

The experimental Next.js integration targets Next 16.3.8 App Router routes on the Node runtime. It
does not import Next itself: App Router supplies standard Web `Request` objects, and the adapter
returns standard `Response` objects from the existing HTTP and official MCP handlers.

For a public read, install the server peer and the server-boundary marker, and install the
client in development for protocol verification:

```sh
npm install @modelcontextprotocol/server@2.3.0 server-only@0.0.1
npm install --save-dev @modelcontextprotocol/client@2.3.0
```

The app-owned server registry module exports its public-read-only authorizer, such as the
checked policy in [adopt an existing site](adopt-existing-site.md). Supply it in the route:

```js
// app/mcp/route.js
import { createNextMcpRoute } from '@uppercut-labs/agent-native/next';
import { registry, publicReadAuthorization } from '../../lib/server-registry.js';

export const runtime = 'nodejs';
export const { GET, POST, DELETE } = createNextMcpRoute(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});
```

This policy permits explicitly public reads. Protected tools require the request-specific
verified identity and grants described in [permissions](permissions-and-discovery.md).

Mount `createNextHttpRoute` from a catch-all route covering `/agent-native/v1`. Keep server registry
modules marked `server-only`. The two route factories share the existing registry/executor behavior,
including schema checks, authorization, discovery, request bounds, and deadlines.

Browser support is isolated at `@uppercut-labs/agent-native/next/browser`. Call `sync()` from a
client component when `usePathname()` changes because Next exposes no stable DOM navigation event.
Registration remains feature-detected through the underlying WebMCP adapter. A normal page must
remain useful when that API is absent.

The init inspector recognizes Next from dependency and filesystem evidence without importing config
or application modules. It proposes manual integration and never rewrites existing Next auth,
layout, config, or routes. An existing `/mcp` route is a conflict for same-origin MCP mode and yields
no proposed edits.

See the [E03 fixture](https://github.com/uppercut-labs/agent-native/blob/main/examples/e03-next-reading-list/project/README.md) and
[UAN-014 local verification evidence](evidence/UAN-014-next.md).

## Verify the ownership boundary

With Node.js 22 or newer, run `npm ci` and `npm run example:e03` from the package root.
The fresh export installs Next, tests routes and the official MCP client, builds the production
app, and scans browser assets for a fake server-only sentinel. A cross-user save is denied
before mutation by this checked owner guard:

<!-- source:examples/e03-next-reading-list/project/lib/saved-list.js#saved-list-owner-check -->
~~~js
function authorizeOwner(identity, ownerUserId) {
  assertFixtureIdentity(identity);
  if (identity.userId !== ownerUserId) {
    throw new SavedListAuthorizationError();
  }
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e03-next-reading-list/project/lib/saved-list.js#L41)
<!-- /source -->

If the browser scan finds the sentinel, keep `server-only` modules out of client imports and
rerun the export. The [E03 project](https://github.com/uppercut-labs/agent-native/blob/main/examples/e03-next-reading-list/project/README.md)
lists the expected final smoke lines and fixture limits.
