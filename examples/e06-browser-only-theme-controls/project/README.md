# E06 - Browser-only theme controls

This plain Vite page changes only its own document theme. The regular button works in any browser.
When WebMCP exists, the page registers one page-local capability using the current draft API on
document.modelContext and removes it with an AbortSignal when the adapter is disposed or the page
is hidden. No network endpoint or server credential is involved.

The capability is a protected write. This example opts it into page discovery with canExpose, then
authorizes every invocation again through the shared executor. Other protected tools stay hidden by
default, and no server-only binding is projected into the browser.

From the repository root, run npm run example:e06. The command builds and packs the library,
exports and installs this standalone project, runs the simulated lifecycle fixture, and builds
browser assets. The generated project is examples/e06-browser-only-theme-controls/.exported; use
npm run dev there to serve the ordinary page locally.

The WebMCP fixture is simulated: it uses a fake API object to exercise registration, invocation,
disposal, authorization and unsupported-browser behavior. Separately, the repository's
test/uan023-native-webmcp.mjs probe runs this built page in Chrome 155 with its opt-in WebMCP
feature. That run listed and invoked the tool through Chrome and removed it on pagehide. No shipping
browser agent was used. The tool shape follows the current
WebMCP draft at https://webmachinelearning.github.io/webmcp/. The server projection deliberately
fails with binding-unavailable; this page-local operation has no remote implementation.
