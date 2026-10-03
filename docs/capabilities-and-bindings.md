# Capabilities and bindings

A capability definition describes a versioned outcome and its runtime input/output contracts. It
does not need an implementation. A binding supplies that implementation for named runtime
targets. Definitions and bindings compose into an immutable checked registry; requests execute
through the shared gateway.

## Frozen authoring signatures

The v0 authoring surface is exercised in the installable examples under `examples/`. Definitions
require identity, description, input and output schema ports, risk, and access. Public access is
allowed only for read capabilities. Protected access carries one or more scopes; it does not issue
or persist grants.

```ts
defineCapability({
  identity: { namespace: 'example.catalog', name: 'album.lookup', majorVersion: 1 },
  description: 'Look up a public sample album by its slug.',
  input: albumInput,
  output: albumOutput,
  risk: 'read',
  access: { kind: 'public' },
});
```

Each binding has a unique slug and one or more explicit targets: `browser`, `server`, or `local`.
No runtime is inferred. A server-only binding is unavailable to a browser request. If multiple
bindings match one capability and runtime, the caller must specify `bindingId`; otherwise execution
returns a `binding-ambiguous` failure.

Every execution request provides a runtime, caller, and `AuthorizationPort`. The executor validates
input first, awaits `authorize` for every invocation, invokes only the selected binding after an
allow result, then validates output. Authorization errors deny execution. Public-read examples
implement their own explicit policy port; there is no implicit allow-all default. The port is the
adopter's policy boundary, not a durable grant store or identity integration.

The result is a discriminated `success` or `failure`. Failure reasons include invalid identity,
missing capability, unavailable or ambiguous binding, invalid input, denied authorization,
authorization error, invalid output, and handler failure. Each failure includes a stable
`DiagnosticObservation` without input, output, credentials, or exception text.

## Runnable examples

- [E01 domain execution slice](https://github.com/uppercut-labs/agent-native/blob/main/examples/e01-album-catalog/project/README.md) proves found and
  missing album outcomes plus malformed-slug rejection through local execution.
- [E12 shared unit converter](https://github.com/uppercut-labs/agent-native/blob/main/examples/e12-shared-unit-converter/project/README.md) proves the
  converter through an explicit local binding and the same executor.

Run `npm run example:e01` and `npm run example:e12` at the repository root for fresh tarball
exports, independent installs, tests, and CLI output. These examples do not implement the full E01
Astro retrofit or claim browser, MCP, HTTP/OpenAPI, or real-host support.

## Tested source and first run

With Node.js 22 or newer, run `npm ci` in the repository root, then
`npm run example:e01` and `npm run example:e12`. E01 returns a found or missing album through
the local executor; a malformed slug fails input validation before its handler runs. E12 prints
a versioned JSON conversion result with `30.48 cm`; an unsupported unit returns
`invalid-input` before the shared converter runs. See the [E01 project](https://github.com/uppercut-labs/agent-native/blob/main/examples/e01-album-catalog/project/README.md)
and [E12 project](https://github.com/uppercut-labs/agent-native/blob/main/examples/e12-shared-unit-converter/project/README.md) for independent exports.

E01 executes a registered album lookup with an explicit public-read policy:

<!-- source:examples/e01-album-catalog/project/src/catalog.mjs#local-album-execution -->
~~~js
/** @param {unknown} input */
export function runAlbumLookup(input) {
  return executeCapability(registry, {
    identity: getAlbumCapability.identity,
    runtime: 'local',
    input,
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  });
}
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e01-album-catalog/project/src/catalog.mjs#L36)
<!-- /source -->

E12 binds one conversion function to local and browser runtimes:

<!-- source:examples/e12-shared-unit-converter/project/src/converter.mjs#shared-converter-bindings -->
~~~js
export const localConversionBinding = bindCapability(convertDistanceCapability, {
  id: 'local-converter',
  targets: ['local'],
  execute: convertDistance,
});
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e12-shared-unit-converter/project/src/converter.mjs#L43)
<!-- /source -->
