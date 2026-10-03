# E12 — Shared unit converter

This is a local Node example of one capability contract, one explicit local binding, and a pure
deterministic centimeter/inch converter. Calls use the shared executor, which selects the local
binding, validates input, checks the required authorization port, invokes the handler, and validates
output. The converter has no network, account, framework, or transport dependency. Invalid units
and non-finite numeric inputs fail before the handler runs.

From the repository root, run `npm run example:e12`. That command builds and packs the actual
package, exports this project with the tarball included under `vendor/`, installs the exported
project from its lockfile in a separate directory, and runs its tests. The generated standalone
project is `examples/e12-shared-unit-converter/.exported`; there run `npm ci`, `npm test`, or
`npm start`. The generated CLI prints a versioned JSON result containing `30.48 cm` in the value object; execution-target diagnostics stay on stderr. The negative path sends an unsupported unit and
expects a structured `invalid-input` failure.

The tarball is included only to prove independent package installation before the public npm
release. After publication, the generated project can install `@uppercut-labs/agent-native` from
npm. This example does not claim MCP protocol or real-host compatibility.
