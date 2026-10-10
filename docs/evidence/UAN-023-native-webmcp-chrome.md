# UAN-023 native WebMCP in Chrome 155

Checked 2026-10-10 on macOS arm64 with Google Chrome 155.0.8059.39 (stable channel), Node 26.10.0 and npm 11.19.1. This is the first native WebMCP result for Agent Native. Earlier browser evidence used a simulated `document.modelContext`, and the [2026-10-03 probe](UAN-023-inspector-host-probe.md) found no native API in default Chrome 154.

## Host and access

Chrome ships WebMCP behind an opt-in. Chrome's [WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp) names `chrome://flags/#enable-webmcp-testing` for local testing and an origin trial for sites. The probe launches a separate headless Chrome process with a temporary profile and `--enable-features=WebMCP`, the feature behind that flag. It does not touch any user browser profile. A second run without the feature confirms that default Chrome 155 still has no `document.modelContext`.

With the feature on, Chrome exposes `document.modelContext` with `registerTool`, `getTools`, `executeTool`, `ontoolchange` and `when`. This matches the [current draft](https://webmachinelearning.github.io/webmcp/) that the adapter targets. On the host side, the experimental DevTools `WebMCP` domain reports `toolsAdded` and `toolsRemoved` and accepts `invokeTool`. Agent Native's own tests use the in-page API and that DevTools domain; an agent host would use the browser's own APIs. No AI agent, prompt or model was involved.

## Reproduce

```sh
npm ci
npm run example:e06
npm run example:e01
node test/uan023-native-webmcp.mjs
```

Set `CHROME_PATH` if Chrome is not at the default macOS location. The script serves the built E06 and E01 static output on loopback and asserts every outcome below.

## Observed results

| Example | Check | Result |
| --- | --- | --- |
| E06 | Default Chrome, no feature | No `document.modelContext`; the page shows its human-control fallback text |
| E06 | `WebMCP.enable`, then load | `toolsAdded` reports `uan.15.example.browser.9.theme.set.v1` with the draft-2020-12 input schema and annotations `readOnly: false`, `consequential: false` |
| E06 | Host `invokeTool` `{theme:"dark"}` | `Completed`; output `{ ok: true, capabilityId: "example.browser:theme.set@1", value: { theme: "dark" } }`; page theme changed |
| E06 | Host `invokeTool` `{theme:"purple"}` | `Completed` with the safe `Capability input is invalid.` envelope; theme unchanged |
| E06 | `pagehide` on the Window | The adapter's registration `AbortSignal` removed the native tool (`getTools()` count 1 to 0) |
| E01 | Static Astro `/albums/` | One read tool `uan.15.example.catalog.12.album.lookup.v1`, `readOnlyHint: true`; page status says browser agent tools are available |
| E01 | `executeTool` `first-light` / unknown slug | Found album and typed `{ kind: "missing" }` results |
| E01 | Astro client navigation to `/about/`, then back | Tool removed on `/about/` (0 tools) and registered again on `/albums/` |

## Change made from this evidence

The draft and Chrome define the annotations `readOnlyHint`, `untrustedContentHint` and `consequentialHint`. The browser adapter previously sent MCP's `destructiveHint`, which Chrome silently dropped, so a destructive capability reached Chrome with no risk hint. The adapter now sets `consequentialHint` for `risk: 'destructive'` capabilities and keeps `readOnlyHint` for reads. The MCP adapter keeps MCP's own `destructiveHint`. Destructive browser tools still require explicit exposure and per-call authorization. The new annotation is unit-tested with the simulated API, because neither E06 nor E01 has a destructive browser tool.

## Limits

- Native WebMCP was verified only in Chrome 155 with the opt-in feature. Default Chrome, other browsers and origin-trial tokens were not tested.
- Calls came from Chrome's DevTools protocol, not from a shipping browser agent. Agent consent, prompting and tool selection are untested.
- Leaving a document by full navigation produced no `toolsRemoved` DevTools event within five seconds. The document is discarded, and the adapter's `pagehide` cleanup was verified separately.
- Commercial MCP and MCP Apps hosts remain unverified.
