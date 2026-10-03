# UAN-015 Node/Hono evidence

This slice extends E05 into a standalone Node/Hono lab. One immutable capability registry provides
the local CLI binding and the server binding used by both generated protocol handlers. A single
Hono application mounts `createHttpHandler` under `/agent-native/v1` and `createMcpHandler` at
`/mcp`; `runCapabilityCli` continues to provide local and remote CLI execution.

The shared server auth boundary derives its caller only from the request and the server-owned
`E05_TOKEN`. HTTP requires the local demo bearer scope. MCP is deliberately anonymous public/read
only, with discovery and invocation still enforced by the core adapter and executor. MCP
`clientInfo` is not consulted for identity. Socket and CLI diagnostics go to stderr and never emit
credential values; successful CLI envelopes remain isolated on stdout.

## Pinned environment and upstream check

- Repository baseline: `eb7ef4f`.
- Project requirement: Node.js 22 or newer. The original Codex sandbox used Node.js v26.9.0 and
  npm 11.19.1; the independent plain-SSH rerun used Node.js v24.18.0 and npm 11.16.0.
- Fixture runtime: `hono` 4.13.12 and `@hono/node-server` 2.1.3.
- Protocol client: `@modelcontextprotocol/client` 2.3.0; the packaged MCP server dependency is 2.3.0.
- The versions were checked against npm registry metadata on 2026-10-02. The implementation follows
  Hono's [official Node.js guide](https://hono.dev/docs/getting-started/nodejs), which documents
  `serve({ fetch, port })`, the returned Node server, and explicit graceful shutdown.

The export harness generated `examples/e05-node-cli/.exported/package-lock.json`; its root entries
pin the Hono framework, Node adapter, official MCP client, Zod, and the local package tarball. The
export directory is generated evidence and remains gitignored.

## Commands and outcomes

- `npm ci --offline --ignore-scripts`: passed at the repository root; 212 packages installed and 0
  vulnerabilities reported.
- `node_modules/.bin/biome format --write <UAN-015 files>`: passed.
- Scoped Biome lint for the three changed JavaScript files: passed with no diagnostics.
- `npm run lint`: passed, with pre-existing informational/warning diagnostics outside UAN-015.
- `npm run typecheck`: passed.
- `npm run build:browser-proof && npm test`: passed, 72 tests.
- `git diff --check`: passed.
- `npm run format:check`: blocked by pre-existing formatting differences in the E02 baseline CSS and
  baseline test; the UAN-015 files were formatted independently and those unrelated files were not
  modified.
- Original Codex sandbox: `npm_config_cache=/tmp/uan015-cache-seeded npm_config_offline=true npm run example:e05`:
  package build, pack, standalone lock generation, and `npm ci` passed with 0 vulnerabilities. Five
  non-socket CLI/security tests passed. Seven socket tests were blocked because this execution
  sandbox rejects every `listen(127.0.0.1)` with `EPERM`; this is an environment limit, not an
  assertion failure. The harness correctly stopped before `npm start` after the test failure.
- In-process `app.request` checks returned HTTP 200 with the expected First Light value and MCP 400
  for malformed JSON, confirming the Hono mount paths without opening a socket.
- Independent plain-SSH verification on the same clone: `npm run example:e05` passed the standalone
  build and pack, lockfile install with 0 vulnerabilities, all 12 fixture tests, and the local CLI
  start. The passing tests included real loopback HTTP with the official MCP client, bounded
  shutdown, SIGTERM, and port-conflict coverage. `npm run lint`, `npm run typecheck`,
  `npm run build:browser-proof && npm test` (72 tests), and `git diff --check` also passed there.
  `npm run format:check` failed only on the same pre-existing E02 baseline CSS and test formatting.

The checked-in socket tests cover matching HTTP and official MCP-client lookup values, unauthorized
HTTP, malformed MCP, bounded-operation shutdown without unhandled rejection, SIGTERM, and sanitized
port-conflict reporting. Existing E05 tests retain local/remote CLI parity, authorization, missing
profiles, unknown versions, malformed input, shell metacharacters, timeouts, and redaction.

## Limitations

No service was deployed and no npm package was published. The fixture does not prove compatibility
with a commercial MCP host, a provider runtime, or Hono releases other than the pinned versions.
The original Codex sandbox could not execute real loopback round trips, but the independent
plain-SSH rerun executed them successfully on the same clone. The token and environment-backed
profile are synthetic local examples, not production credential storage. Production use still
needs TLS, trusted identity verification, secret management, rate limiting, observability, and
process supervision.
