# Browser-local WebMCP

Import the browser-only subpath so application browser bundles do not load HTTP or MCP server
adapters:

~~~ts
import { createBrowserCapabilityAdapter } from '@uppercut-labs/agent-native/browser';

const adapter = createBrowserCapabilityAdapter(document);
const report = await adapter.sync(registry);
~~~

The adapter feature-detects the current draft API at document.modelContext. It registers
capabilities only when the registry has exactly one browser binding. The WebMCP tool name is a
deterministic length-coded projection of the capability identity and follows the draft's allowed
ASCII character set and 128-character limit.

By default, discovery includes only public read capabilities. An application may explicitly opt
in to a protected page-local tool with canExpose; every execution still goes through the shared
executor and the application's AuthorizationPort. resolveExecutionContext is read for each tool
call, so authorization and identity are not captured as browser secrets. Resync after route or
authentication changes to abort stale registrations and register the current projection.

The adapter owns each registration with the WebMCP registerTool(tool, { signal }) AbortSignal.
Calling dispose() or receiving pagehide on the document's owning Window aborts those
registrations. Repeated adapter creation for the same Document returns the same adapter instance.
The registration signal controls availability; WebMCP passes a separate execution signal to the
tool callback. Revoked callbacks also reject retained references after a resync or dispose.

The normal human interface should work when WebMCP is absent. E06 demonstrates this with a
page-local theme action and no server fallback. E12 uses the same converter function through local
and browser bindings. The lifecycle fixture uses a simulated API and is labeled as such; no actual
browser agent or native host was tested.

The API shape follows the current WebMCP draft at https://webmachinelearning.github.io/webmcp/.
That draft exposes Document.modelContext.registerTool() in secure contexts, and the registration
options accept an AbortSignal. This package does not claim support for a particular browser
release or agent host.

## Verify the browser-only binding

With Node.js 22 or newer, run `npm ci` and `npm run example:e06` from the package root.
The exported page binds its theme action only to `browser`:

{{source:examples/e06-browser-only-theme-controls/project/src/theme.mjs#browser-theme-binding}}

The simulated lifecycle test checks registration, protected invocation, disposal, and the
ordinary button fallback. A server invocation fails with `binding-unavailable`; use a
separate server binding only if the application actually implements one. See the
[E06 standalone instructions](../examples/e06-browser-only-theme-controls/project/README.md).
No native WebMCP host result is implied by this fixture.
