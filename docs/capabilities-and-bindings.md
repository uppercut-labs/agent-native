# Capabilities and bindings

Identity namespace and name are lower-case slug segments separated by dots or hyphens,
with at most 64 characters each; majorVersion is a positive safe integer.

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

Every execution request provides a runtime, caller, and `AuthorizationPort`. The binding receives that caller as `context.caller`, after authorization, so it can scope records to it. The executor validates
input first, awaits `authorize` for every invocation, invokes only the selected binding after an
allow result, then validates output. Authorization errors deny execution. Public-read examples
implement their own explicit policy port; there is no implicit allow-all default. The port is the
adopter's policy boundary, not a durable grant store or identity integration.

The result is a discriminated `success` or `failure`. Failure reasons include invalid identity,
missing capability, unavailable or ambiguous binding, invalid input, denied authorization,
authorization error, invalid output, and handler failure. Each failure includes a stable
`DiagnosticObservation` without input, output, credentials, or exception text.

## Exact identity and explicit binding selection

Run `npm run example:e11` at the repository root for an installed, executable
[selection and diagnostics recipe](https://github.com/uppercut-labs/agent-native/blob/main/examples/e11-diagnostics-fault-lab/project/src/executor-selection.mjs).
After exporting it, `npm run selection` in `examples/e11-diagnostics-fault-lab/.exported`
repeats the sequence. Failed requests invoke no handler:

| Request | Outcome |
| --- | --- |
| `name: 'example.selection binding.read'` | `invalid-identity` |
| Valid identity with `name: 'missing'` | `capability-missing` |
| Browser runtime with local-only bindings | `binding-unavailable` |
| Local runtime with two bindings, no selection | `binding-ambiguous` |
| Exact identity, local runtime, `bindingId: 'primary'` | Success, one handler call |

<!-- source:examples/e11-diagnostics-fault-lab/project/src/executor-selection.mjs#select-binding -->
~~~js
const selected = await executeCapability(registry, {
  identity: { namespace: 'example.selection', name: 'binding.read', majorVersion: 1 },
  runtime: 'local',
  bindingId: 'primary',
  input: {},
  caller: { kind: 'anonymous' },
  authorization: publicRead,
});
assert.equal(selected.kind, 'success');
assert.equal(selected.bindingId, 'primary');
assert.deepEqual(selected.value, { value: 'primary' });
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e11-diagnostics-fault-lab/project/src/executor-selection.mjs#L65)
<!-- /source -->

Namespace, name and major version are separate fields. Never pass a display label or a
space-separated phrase as the name, normalize it into another identity, or silently select
the first binding. If an application exposes an executor wrapper with a fixed namespace,
state that namespace in both its schema descriptions and tool description, give the valid
name example `binding.read`, and reject combined labels. Expose a `bindingId` selection only
when the application's contract permits it. The MCP adapter exposes capabilities with one
server binding; it does not select between ambiguous bindings on behalf of a client.

The same recipe exercises the [MCP operator failure hook](mcp.md#operator-failure-hook).
Keep detailed reasons in a private operator sink; do not expose hidden capabilities or
unredacted exceptions to diagnose generic client errors.

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

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e12-shared-unit-converter/project/src/converter.mjs#L44)
<!-- /source -->
