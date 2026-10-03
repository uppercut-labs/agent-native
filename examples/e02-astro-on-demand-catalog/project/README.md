# E02 Astro on-demand integration

This after-state keeps the original Astro 7.3.5 catalog pages, ordinary JSON route, and existing
official Node adapter in standalone mode. It adds Agent Native's Web `Request` handlers as live Astro
routes at `/agent-native/v1/*` and `/mcp`. Both transports use one application-owned capability
definition, server binding, authorization policy, and validated handler.

Run `npm run example:e02` from the repository root. The export builds and packs the local package,
creates a standalone package lock, installs with `npm ci`, builds Astro, runs contract/build tests,
starts the production server, checks prerendered human navigation, invokes authenticated HTTP and
official-SDK MCP requests, and proves a POST to the static negative-case file is inert.

The album capability is deliberately classified as public, so anonymous MCP tool discovery and
HTTP OpenAPI metadata expose its name, description, and schema. E02 requires the public fixture bearer
token to invoke it over either transport; anonymous invocation is denied. The token is test data, not
production identity. This local proof does not configure TLS, rate limiting, provider deployment,
DNS, or a commercial MCP host. Astro and `@astrojs/node` are pinned to the tested versions; other
adapters and Astro releases are not claimed.
