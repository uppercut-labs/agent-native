# E08 - Reusable versioned capability pack

This fixture publishes `contracts/` as a separate contract-only package. It owns the stable
`example.org` authority and `measurement` namespace and exports one v1 definition with no handler.
`consumer-a.mjs` and `consumer-b.mjs` import that exact definition and provide distinct bindings;
neither copies its schemas. `demo.mjs` and `demo-b.mjs` are separate consumer entrypoints. Each
builds its own registry and runs in a separate process in the test suite.

From the repository root, run `npm run example:e08`. The harness builds and packs the SDK, separately
packs the contract package, copies this project to `.exported`, installs those tarballs, runs the tests, and executes the
demo. In the exported directory, `npm test` covers both bindings, authorization denial, a deliberate
full-identity conflict with both source locations, and an ESM import trace proving the contract
package does not load executor, registry, HTTP, MCP, Zod, or other provider modules.

Run `npm run start:consumer-b` to invoke the second consumer directly. Both consumer entrypoints
return `30.48 cm` for twelve inches, with their own provider labels. They share the exported
project's dependency install; this fixture does not claim two separate npm application packages.

Aliases are opt-in: every import supplies either `{ kind: 'none' }` or an explicit alias list.
Composition never grants scopes, chooses a binding, or starts a transaction. Consumers build the
ordinary registry and call `executeCapability` with their original caller, authorization port,
runtime, and signal.

This example pins the contract and SDK versions used by the fixture. It demonstrates v1 package
composition only; it does not implement a v2 migration, compatibility negotiation, remote registry,
or package signature verification.
