# UAN-019 doctor evidence

This integration adds the `./doctor` public subpath and E11 fault/repair fixture to the unreleased `0.0.0` source package. The report schema is `uan.doctor-report/v1`; findings use stable `checkId` values, explicit evidence levels and sources, and selected/required check profiles. The E11 `local` profile selects six configuration and artifact checks. The `full` profile adds endpoint reachability and a fixture-specific health exchange. It does not claim a real host.

## Canonical research checkout verification

On macOS research with Node 24.18.0, after integrating UAN-018, UAN-020, and the bounded UAN-021 docs slice:

- `npm run typecheck` and `npm run build` passed.
- `node --test test/doctor.test.mjs test/discovery.test.mjs` passed 7/7, including Ajv validation of a serialized doctor report, invalid schema fields, required profile behavior, exception redaction, and policy-filtered listing without handler calls.
- `npm run example:e11` built and packed the current package, installed an independent pinned E11 export, and passed its 7/7 tests. The fault variants and repaired variants include a destructive canary that must not run during diagnostics.
- `npm run docs:check` rendered 29 documentation pages and validated 30 generated HTML pages and 29 search entries after the doctor guide was added.
- Scoped Biome format/lint and `git diff --check` passed.

The isolated worker also passed Node 24 typecheck/build, the same targeted doctor tests, and a fresh E11 standalone export before integration. CI on Node 22/24 is a separate gate and should be linked after this commit is pushed.

## Boundaries

No doctor check makes a network request by default. An explicit E11 loopback probe can verify its local health fixture only. Missing endpoint or browser context remains unknown/skipped. No production identity, real browser, remote MCP host, or application data is verified. Registry inspection and authorized listing are read-only and cannot replace execution-time authorization. The checked-in E11 values are fake local fixtures; real applications provide their own checks and controlled evidence sources.
