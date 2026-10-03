# UAN-020 operational failure safety evidence

This is a local fixture result from an isolated research checkout at public base `8a502b5` on
Node.js 24.18.0. It extends the E07/MCP App threat-fixture note without claiming a deployed host.

## Timed-out writes

A protected MCP write used the official client/server SDK over loopback HTTP, a fixture token and
current in-memory grant, and a 20 ms deadline. Its handler deliberately ignored the aborted signal,
then committed after 60 ms. The client received a tool error saying the write may have completed and
warning against retry. After the handler settled, the test observed one invocation, one commit and
an aborted signal. The adapter made no second invocation. This demonstrates uncertain completion,
not cancellation or at-most-once semantics under a real network retry.

The generated HTTP adapter and remote CLI currently expose public reads only. A direct protected
HTTP write returned `404` before its binding ran. The same protected write submitted to remote CLI
returned `capability-unavailable` before its fetcher or binding ran. CLI local mode has no timeout
implementation. These are explicit surface limits, not write-timeout
claims for HTTP or CLI.

## Default operation and browser boundary

Default init detection and plan creation left the sample project directory, Astro config and
lockfile byte-identical and created no provisioning canary marker. E11's fresh packed install
passed seven fixture checks: its default doctor scans eight fault/repair scenarios without calling
any capability handler or destructive canary. An application can supply its own doctor observer;
that observer's side effects remain an application responsibility. The E07 server's separate
no-default-persistence-path canary is recorded in the threat-fixture note.

E03's fresh packed Next.js production build found the fake server-only sentinel in one server
artifact and absent from 20 browser artifacts, including nine browser source maps. A negative
control appended that sentinel to one emitted browser source map; the scanner failed with
`server-only sentinel leaked into browser artifacts`. The map was restored byte-for-byte and the
scanner then passed again. The sentinel is deliberately fake; this does not prove absence of every
possible secret in arbitrary future application code. No deployed browser was tested.

## Focused reproduction

```sh
npm run typecheck
npm run build
node --test test/mcp.test.mjs test/cli.test.mjs test/http.test.mjs test/init.test.mjs
npm run example:e11
npm run example:e03
```

The source-map negative control was run against E03's ignored `.exported/.next/static` output and
restored afterward; it did not change tracked fixture files. Only focused checks were run in this
isolated clone. Broad Node 22/24 CI and real-host validation remain integration gates.
