# UAN-012 MCP Apps adapter evidence

The implementation was pushed as `47d089e072023504d66b32dabc7b9c4950111654`. [Node 22/24 CI](https://github.com/uppercut-labs/agent-native/actions/runs/37097823731) passed the root check and package dry-run on both versions. Local work and tests ran on `research` over SSH with Node 25.9.0 and npm 11.12.1, without foreground desktop use.

## Verified behavior

- An opt-in `./mcp-apps` subpath uses the official `@modelcontextprotocol/ext-apps@2.0.3` server helpers. Core and browser imports do not load the optional UI SDK. A resource attaches only to a capability visible through ordinary MCP discovery; tool calls and `App.callServerTool` follow-ups use the existing MCP handler, shared executor, schema validation, and authorization path.
- E09 is a standalone album explorer built from E01's shared public catalog definition and data. The official `App` and `AppBridge` fixture receives a real MCP tool result over a local SDK client/server connection, then makes a host-mediated follow-up lookup. It also checks found, missing, denied, unavailable, malformed host input, and text-only result fallback. The denied lookup does not run its binding.
- The resource uses the official `text/html;profile=mcp-app` MIME type. Validation requires a declared canonical capability, unique bounded `ui://` resource mapping, HTML under 1 MiB, and no external element/CSS origins, including protocol-relative network paths. Resource metadata has empty connect, resource, frame, and base-URI CSP allowlists. The view bundles its UI assets and carries no credentials.
- `npm test`, `npm run example:e09` (three E09 tests), `npm run typecheck`, scoped Biome checks, `git diff --check`, and `npm pack --dry-run` passed on `research`. The test handshake has a three-second deadline and closes the view, bridge, MCP client, and server in cleanup.

## Limits

The view/host channel is a deterministic in-memory fixture paired with a real local MCP HTTP client/server connection. No commercial MCP Apps host, browser iframe sandbox, host confirmation prompt, deployment, or production identity provider was tested. Host implementations must enforce the declared CSP and their own trust and consent boundary. The package remains `private: true` at version `0.0.0`; no npm release was made. The existing Astro development/example transitive advisory remains a release gate.
