# UAN-023 commercial agent hosts over remote MCP

Checked 2026-10-10 on macOS arm64 with Node 26.10.0. The server was the flagship E04 Worker sidecar on local workerd (Wrangler `dev --local`). It serves the shared E01 album contract over Streamable HTTP MCP at a loopback address. Each host ran from a temporary working directory under the operator's existing sign-in. No credential was added for this test.

## Antigravity CLI: tool invocation verified

The Antigravity CLI (`agy`, Google) ran with model `gemini-3.8-flash-low`. Its HTTP MCP server entry was added for the test with `agy mcp add` and removed afterwards.

| Run | Host version | Observation |
| --- | --- | --- |
| Manual | 1.2.14 | Host listed `cap_15_example.catalog_12_album.lookup_v1`, called it through `call_mcp_tool` with `{"slug":"first-light"}`, received `{"result":{"kind":"found",…}}` and answered `First Light` |
| `node test/uan023-agent-host.mjs agy` | 1.3.3 (auto-updated) | Same found call and answer. A second prompt sent the invalid slug `Not A Slug!` unchanged; the tool returned an error and no album |

## Claude Code: connection and discovery verified, invocation blocked

Claude Code 2.1.286 ran with an isolated `--mcp-config` and `--strict-mcp-config`. It reported the server `connected` and exposed exactly one tool, `mcp__albums__cap_15_example_catalog_12_album_lookup_v1`. That tool name is Claude Code's own sanitized projection. The standalone CLI's sign-in had expired ("OAuth session expired and could not be refreshed"), so no model turn ran. Claude Code tool invocation therefore remains unverified. After signing in, `node test/uan023-agent-host.mjs claude` repeats the same found and invalid cases.

## Reproduce

```sh
npm ci
npm run example:e04
node test/uan023-agent-host.mjs agy
```

The script starts the sidecar on a free loopback port. For Antigravity it registers a temporary `uan-albums-probe` MCP server, runs the two prompts, asserts the actual tool calls from the host's `stream-json` events, and always removes the server and stops the Worker. It uses model inference on the operator's account, so it is not part of `npm run check`.

## Limits

- Each host version was observed once on one machine. Host model behavior may vary between runs.
- The server ran on loopback. No deployed sidecar, external identity provider or protected capability was used.
- MCP Apps UI rendering in these hosts was not tested; the rendered MCP Apps host evidence remains the [Inspector run](UAN-023-inspector-web-and-astro-adoption.md).
