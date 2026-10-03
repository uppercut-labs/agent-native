# MCP Apps adapter

MCP Apps is an optional presentation layer for an existing MCP capability. Install the official SDK when using this adapter:

~~~sh
npm install @modelcontextprotocol/server@2.3.0 @modelcontextprotocol/ext-apps@2.0.3
~~~

Import the isolated subpath only in the server application:

~~~ts
import { createMcpAppsHandler } from '@uppercut-labs/agent-native/mcp-apps';

const handler = createMcpAppsHandler(registry, {
  ...mcpOptions,
  resources: [{
    capabilityId: 'example.catalog:album.lookup@1',
    uri: 'ui://catalog/album-explorer.html',
    name: 'Album explorer',
    html: bundledHtml,
  }],
});
~~~

Each resource maps to one capability already present in the registry. The adapter checks canonical capability IDs, unique mappings, bounded resource size and an exact ui:// resource URI. UI metadata is attached only after the ordinary MCP discovery rules expose the bound capability. Resource reads are registered only for those visible app tools. Tool execution still uses the same shared executor, schemas, authorization and per-surface exposure policy. The resource does not create a second API.

Resources use the official ext-apps server helpers and MIME type text/html;profile=mcp-app. CSP metadata closes connect, resource, frame and base-URI origins by default. Resource HTML is capped at 1 MiB; external resource-bearing elements and CSS origins are rejected. The view should use the official App host bridge for follow-up calls. It must not fetch the MCP endpoint directly or embed credentials. Hosts remain responsible for sandbox enforcement and identity.

Provide both content text and structuredContent on tool results. Text-only MCP clients still receive the ordinary result. Views validate structured data against the existing capability output schema and can parse the text JSON fallback. The E09 view shows loading, found, missing, denied and unavailable states, including malformed host input.

Run the standalone fixture with npm run example:e09. Its conformance fixture pairs the official ext-apps App and AppBridge classes through a deterministic in-memory channel; the outer tool calls use the official MCP client/server SDK over a real loopback HTTP socket. It verifies initial tool-result delivery, a host-mediated follow-up lookup, a missing album, authorization denial before binding effects, malformed UI input, text fallback, MIME type and undeclared resource/origin rejection.

This fixture is SDK-level evidence, not browser iframe or commercial-host acceptance. No real MCP Apps host was exercised. Verify actual host rendering, sandbox/CSP enforcement, host confirmation behavior, and authentication in UAN-023. Core and browser-only imports do not import ext-apps; the adapter requires the optional peer only when its subpath is loaded.

Official API references: [quickstart](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md) and [overview](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md).

## Verify host-mediated follow-up

With Node.js 22 or newer, run `npm ci` and `npm run example:e09` from the package root.
The E09 controller calls the host bridge for a follow-up lookup:

<!-- source:examples/e09-album-explorer/project/src/view-controller.mjs#host-mediated-lookup -->
~~~js
const result = await app.callServerTool({ name: toolName, arguments: { slug } });
const outcome = decodeResult(result, outputSchema);
show(outcome);
return outcome;
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e09-album-explorer/project/src/view-controller.mjs#L52)
<!-- /source -->

The SDK fixture checks found, missing, denied, malformed, and text-only fallback states.
If the host supplies malformed input or denies a call, the view shows an explicit
unavailable or denied state; it never fetches MCP credentials itself. See the
[E09 project instructions](https://github.com/uppercut-labs/agent-native/blob/main/examples/e09-album-explorer/project/README.md).
A rendered browser host remains a separate compatibility check.
