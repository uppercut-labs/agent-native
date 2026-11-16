# ANUI-004 UI patterns as MCP Apps

Recorded November 16, 2026 on macOS with Node.js 26.10.0, from the `agent-native-ui` branch. The package was not published.

## SDK conformance (E13)

`npm run example:e13` packs this package, installs it into the exported E13 project with its pinned dependencies, builds three MCP App resources and runs the suite. The outer tool calls use the official MCP client and server over a loopback HTTP socket. The official ext-apps `App` and `AppBridge` are paired through an in-memory channel and deliver tool input and results to the UI controller.

| Check | Result |
| --- | --- |
| Anonymous discovery | Only the three read tools are listed, each read-only with a `ui://` view; save tools are hidden |
| Resources | `text/html;profile=mcp-app`, under 1 MiB, no external script source; accepted by the adapter's strict resource scan |
| Review view | Renders from the host-delivered result; text fallback carries the same data; anonymous saving is disabled; a host-mediated refresh keeps a local edit |
| Authenticated save | An editor with the write grant saves through `App.callServerTool`; the receipt updates the view; a replayed `requestId` returns the same revision with `replayed: true`; a reused `requestId` with different input is refused |
| Missing grant | A signed-in viewer without the write grant does not see the save tool, a direct call is refused as unknown, and the local edit stays |
| Explorer and media | Render from host results; the media save succeeds for the editor; a malformed host result is reported and the last valid state is kept |

The view bundle is React 19.3.1 (production build), the official `App` bridge and Agent Native UI. Minified code places `<` directly before identifiers, which the resource scan reads as HTML tags; the build inserts a space after those operator tokens using a JavaScript tokenizer, so string and regular-expression contents are unchanged and the scan stays strict.

## Limits

This is SDK-level evidence. Browser iframe sandboxing, host CSP enforcement and commercial host rendering are recorded separately when run. The fixture's test identities exist only in local test mode; a publicly reachable fixture is anonymous and read-only.
