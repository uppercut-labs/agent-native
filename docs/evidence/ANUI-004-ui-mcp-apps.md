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

## ChatGPT web (November 16, 2026)

The anonymous E13 server ran on macOS and was reached through a temporary HTTPS tunnel, added in ChatGPT as a custom MCP server with no authentication. Chat mode, thinking effort Medium. ChatGPT's server called the fixture as `openai-mcp/1.0.0`.

| Check | Result |
| --- | --- |
| Review queue | Rendered in the conversation from the tool result, in ChatGPT's dark theme, with the note that saving needs a signed-in account; the model's text reply described the same records |
| Local edits | Selecting a record and editing a draft updated the before/after view without a server call; "Save selected" stayed disabled |
| Host-mediated refresh | "Refresh from server" reached the server through ChatGPT and kept the local edit and selection |
| Allowlisted context | "Share selection with the chat" was accepted; asked what it received, ChatGPT quoted `{"surfaceId":"review","selection":{"/selected":["landing"]}}` and said it could not see the unsaved draft |
| Probability explorer | Opened with the model's arguments (5 attempts, 7%: 30.43%); the keyboard moved Attempts to 6 and the result recalculated to 35.3% with no server request |
| Media annotation | Transcript, playhead and annotation editing worked; saving stayed disabled. Audio generated in the page did not load: the view showed "The registered media could not be loaded." A `blob:` source failed; a `data:` source was not confirmed because the host may have kept the earlier resource |

Visual differences seen only in ChatGPT: the focus ring and chart bars rendered darker than the theme's accent. The same build in Chrome with the dark theme computes the expected accent, so the host's framing is the likely cause; not yet explained.

## Claude web (November 16, 2026)

Claude's connector check made no request to the fixture at a `trycloudflare.com` tunnel or at a `workers.dev` Worker. With the owner's approval the same Worker was served on a custom domain (`ui-fixture.dvn.pw`), added as a custom connector with no sign-in, and removed after the run. Model: Haiku 5.5. Claude's server called the fixture as `Claude-User`.

| Check | Result |
| --- | --- |
| Review queue | Rendered in the tool-call card; the model answered from the structured result, including `canSave: false` |
| Local edits | Selection and draft edits updated the before/after view; saving stayed disabled |
| Host-mediated refresh | Reached the server through Claude and kept the local edit |
| Allowlisted context | Asked what it received, Claude quoted `{"surfaceId":"review","selection":{"/selected":["landing"]}}` and said it could not see the unsaved draft |
| Probability explorer | Opened with the model's arguments (30.43%); the keyboard moved Attempts to 6 and the result recalculated to 35.3% with no server request |
| Media annotation | With the fixes below, the generated tone loaded as a `data:` URL, played (muted) with the playhead in sync, and an annotation was added at the playback position |

Found and fixed during the Claude run: Claude frames the view on a white background, so the page's light text on a transparent background was unreadable; the page now sets its own background and text color for each theme. The renderer refused `data:` media; it now accepts base64 `data:audio/*` and `data:video/*` URLs registered by the application. Claude kept the earlier resource within a conversation; a new conversation picked up the rebuilt view. ChatGPT was not rerun with these fixes.

## Limits

The host runs used an anonymous, read-only fixture with synthetic data, so the authenticated save path was exercised only at the SDK level. No physical phone, browser zoom or publication was tested. The fixture's test identities exist only in local test mode.
