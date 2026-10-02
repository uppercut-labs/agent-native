# E12 — Shared unit converter

This is a local Node example of one typed capability contract and a pure deterministic
centimeter/inch converter. The converter has no network, account, framework, or transport
dependency. Invalid units and non-finite numeric inputs are rejected by the same schema used by
the capability contract.

From the repository root, run `npm run example:e12`. That command builds and packs the actual
package, exports this project with the tarball included under `vendor/`, installs the exported
project from its lockfile in a separate directory, and runs its tests. The generated standalone
project is `examples/e12-shared-unit-converter/.exported`; there run `npm ci`, `npm test`, or
`npm start`. The demo command prints `30.48 cm`.

The tarball is included only to prove independent package installation before the public npm
release. After publication, the generated project can install `@uppercut-labs/agent-native` from
npm. This example does not claim MCP protocol or real-host compatibility.
