# Next.js App Router

The experimental Next.js integration targets Next 16.3.8 App Router routes on the Node runtime. It
does not import Next itself: App Router supplies standard Web `Request` objects, and the adapter
returns standard `Response` objects from the existing HTTP and official MCP handlers.

```js
// app/mcp/route.js
import { createNextMcpRoute } from '@uppercut-labs/agent-native/next';
import { registry } from '../../lib/server-registry.js';

export const runtime = 'nodejs';
export const { GET, POST, DELETE } = createNextMcpRoute(registry);
```

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

See the [E03 fixture](../examples/e03-next-reading-list/project/README.md) and
[UAN-014 evidence draft](evidence/UAN-014-next.md).
