# E08 - Reusable versioned capability pack

This fixture publishes `contracts/` as the separate contract-only package
`@example/e08-album-contracts`. One pack exports both
`example.org.catalog:album.lookup@1` and `example.org.catalog:album.lookup@2`.

V1 accepts `{ slug }` and returns the legacy `{ slug, title }` shape. Its consumer delegates data
access to the shared internal lookup but deliberately projects only that old response. V2 requires
`{ slug, locale }` and returns `{ slug, locale, titles }`. The checked fixtures are
`fixtures/album-v1-output.json` and `fixtures/album-v2-output.json`.

`demo.mjs` invokes v1 through the explicit `album-v1` alias. `demo-b.mjs` invokes v2 through
`composition.select()` with the exact namespace, name, and major. The alias targets the complete v1
canonical ID and cannot move to v2. Each consumer supplies its own binding and runs in an independent
process during tests.

From the repository root, run `npm run example:e08`. The harness builds and packs the SDK, separately
packs the contracts, copies the project to `.exported`, installs both tarballs, runs tests, and runs
the v1 demo. Tests cover coexistence, exact selection, output fixtures, required-input and output
shape changes, changed defaults/units, field rename reporting, missing semantic review for an
identical-schema major, same-ID breaking replacement, and implicit retirement of a supported major.

The contract package imports only the SDK contracts and composition entrypoints. An ESM load trace
rejects executor, registry, HTTP, MCP, Zod, data, and consumer modules. Handlers remain application
code. The migration note documents semantics independently of the structural schema report, and
lifecycle state explicitly deprecates v1 without removing it or inferring policy from package semver.

This is local fixture evidence, not a remote registry, package-signature system, or automatic wire
negotiator. Consumers must select the canonical major they implement and apply their own rollout and
retention policy.
