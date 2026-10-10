# E12 — Shared unit converter

This example uses one capability contract and one pure deterministic centimeter/inch converter
through local, browser and server bindings. Calls use the shared executor, which selects the requested
local, browser or server binding, validates input, checks the required authorization port, invokes the handler, and validates
output. The converter has no network, account, framework, or transport dependency. Invalid units
and non-finite numeric inputs fail before the handler runs. The server binding is also served by the
package's generated HTTP route (`conversionHttpHandler`). Tests check that its responses match the
local and browser results, and that invalid input returns HTTP 422 `invalid_input`.

From the repository root, run `npm run example:e12`. That command builds and packs the actual
package, exports this project with the tarball included under `vendor/`, installs the exported
project from its lockfile in a separate directory, and runs its tests. The generated standalone
project is `examples/e12-shared-unit-converter/.exported`; there run `npm ci`, `npm test`, or
`npm start`. The generated CLI prints a versioned JSON result containing `30.48 cm` in the value object; execution-target diagnostics stay on stderr. The negative path sends an unsupported unit and
expects a structured `invalid-input` failure.

The tarball is included only to prove independent package installation before the public npm
release. After publication, the generated project can install `@uppercut-labs/agent-native` from
npm. The browser-target path proves runtime selection through the shared executor; it does not claim
WebMCP host compatibility. This example does not claim remote MCP protocol or real-host compatibility.
