# E11 — Diagnostics fault lab (before-state fixture)

This project materializes isolated fault cases for the future doctor integration. It does not
implement diagnostic checks or claim that any host was inspected. Each invocation creates a
temporary sandbox and prints its path. The cases expose real files and config fields, so a doctor
can inspect them later. Only fake local credentials and loopback endpoints are used.

From this project directory, run `node --test test/*.test.mjs` and `node src/cli.mjs --list`.
Run `node src/cli.mjs missing-binding` to create a fault sandbox, or
`node src/cli.mjs missing-binding --repaired` to create its repaired counterpart. The command
prints JSON with `sandboxRoot`; inspect its `project.json`, `artifacts/`, `roots/`,
`credentials/`, and `handlers/` files. Remove each temporary sandbox when done.
The repository export harness can later pack this into a standalone install with a pinned lockfile.

The cases are missing binding, stale artifact, ambiguous root, insufficient scope, unsupported
browser, missing credentials, unreachable endpoint, and no endpoint. The last case deliberately
means network evidence is **unknown**, never passed. For the repaired endpoint case, start
`node src/health.mjs` in another terminal before probing `http://127.0.0.1:8787/health`.
No real browser, remote MCP host, production endpoint, or account is involved.

Every sandbox advertises `example:catalog.erase@1` as a mutation canary. Its handler deletes
only that sandbox's `data/catalog.json`, writes `canary-invoked.marker`, then throws. Launching
fixtures and any future default doctor checks must never call it. Baseline tests confirm the
data remains and the marker never appears. The canary is for safety verification only.
