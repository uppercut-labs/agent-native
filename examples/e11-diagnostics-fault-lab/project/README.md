# E11 - Diagnostics fault lab

This project materializes and diagnoses isolated fault cases with the reusable
`@uppercut-labs/agent-native/doctor` foundation. Each invocation creates a temporary sandbox and
prints its path. Checks inspect only those files unless an explicit loopback probe is enabled. Only
fake local credentials and loopback endpoints are used.

From the repository root, first run `npm run build`. From this project directory, run
`node --test test/*.test.mjs` and `node src/cli.mjs --list`. Run
`node src/cli.mjs missing-binding` to create a fault sandbox, or
`node src/cli.mjs missing-binding --repaired` to create its repaired counterpart. The command
prints JSON with `sandboxRoot`; remove each temporary sandbox when done.

Run `node src/cli.mjs doctor missing-binding`; it exits `1` and reports
`UAN-019.binding-configured` as `failed`. The repaired command
`node src/cli.mjs doctor missing-binding --repaired` still exits `3` because required network
checks are deliberately `skipped` until probing is requested, while
`UAN-019.binding-configured` is `passed`.
Run `node src/cli.mjs doctor missing-binding --repaired --profile local` to select the six
configuration/artifact checks; it exits `0` and does not probe the network. The default `full`
profile selects eight checks and requires reachability and the E11 fixture health exchange.
Machine output uses `uan.doctor-report/v1`, stable `checkId` fields, the selected and required
check IDs, evidence source, and an exit code. A local pass does not claim network or host support.

From the repository root, `npm run example:e11` builds, packs, installs with a generated pinned
package lock, runs the standalone tests, and lists the scenarios. This is the exact standalone
export path tested by the repository harness.

The cases are missing binding, stale artifact, ambiguous root, insufficient scope, unsupported
browser, missing credentials, unreachable endpoint, and no endpoint. The last case means network
evidence is `unknown`, never passed. For the repaired endpoint case, start `node src/health.mjs` in
another terminal, then run
`node src/cli.mjs doctor unreachable-endpoint --repaired --probe-loopback`. It exits `0` and reports
`UAN-019.endpoint-reachable` and `UAN-019.health-protocol` as `passed`. A fault endpoint probe exits
`1`; no configured endpoint reports `unknown` and exits `3`. No real browser, remote MCP host,
production endpoint, or account is involved, and loopback fixture protocol evidence must not be
presented as a real-host protocol pass.

Every sandbox advertises `example:catalog.erase@1` as a mutation canary. Its handler deletes only
that sandbox's `data/catalog.json`, writes `canary-invoked.marker`, then throws. Launching fixtures
and all doctor checks must never call it. Tests confirm the data remains and the marker never
appears. The canary is for safety verification only.
