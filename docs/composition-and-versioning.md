# Composition and versioning

Reusable capability packs distribute contracts, not providers. A pack owns an authority and a
namespace; its definitions use the combined namespace `<authority>.<namespace>`. For example,
authority `example.org` plus namespace `measurement` owns
`example.org.measurement:distance.convert@1`. This keeps the identity stable when consumers choose
different package names or bindings, and lets two authorities use the same local capability name.

```js
export const measurementPack = defineCapabilityPack({
  identity: { authority: 'example.org', namespace: 'measurement' },
  source: '@example/distance-contracts@1.0.0',
  definitions: [distanceConversion],
});
```

Definitions remain ordinary `CapabilityDefinition` values. A consumer imports the same object,
passes it to `bindCapability`, composes packs, and creates a normal registry. Composition does not
wrap handlers or create a privileged execution path. Call `executeCapability` with the caller,
authorization port, runtime, and optional signal received by the application. Authorization is
evaluated for every call; composition does not grant scopes or claim a transaction boundary.

## Imports and aliases

Every pack import names a source location and chooses an alias policy. `{ kind: 'none' }` is the
default behavior expressed explicitly. `{ kind: 'explicit', aliases: [...] }` maps a local alias to
one full canonical capability ID. There is no inferred remapping. Missing targets, duplicate aliases,
and duplicate canonical identities fail composition, and conflict errors include both import source
locations.

```js
const composition = composeCapabilityPacks([
  {
    pack: measurementPack,
    source: 'src/bootstrap.mjs:12',
    aliasPolicy: {
      kind: 'explicit',
      aliases: [
        {
          name: 'distance',
          capabilityId: 'example.org.measurement:distance.convert@1',
        },
      ],
    },
  },
]);
```

`composition.resolve()` accepts a canonical ID or an explicitly declared alias. Registry creation
uses `composition.definitions`; aliases never alter the canonical identity.

## Surface names

`capabilitySurfaceNames(identity)` deterministically maps one identity to its CLI ID, HTTP suffix,
MCP tool name, and OpenAPI operation ID. HTTP segments are encoded separately and MCP/OpenAPI names
use length-prefixed components, so punctuation boundaries cannot collapse. MCP names over its
128-character budget receive a visible `_fnv1a64_<digest>` qualifier instead of silent truncation.
`createCapabilitySurfaceMap()` and composition reject any mapping collision.

The CLI ID is always the canonical `<namespace>:<name>@<major>` form. Existing uncomposed definitions
and adapters remain valid.

## Version boundary

`majorVersion` remains part of the canonical identity, so different majors may coexist as distinct
definitions. This release provides pack composition and identity/name stability only. It does not
perform schema migration, select a compatible major, generate v2 contracts, or promise wire
compatibility between majors. Those migration mechanics belong to UAN-017.

Run `npm run example:e08` for the independently installed contract-package fixture. E12 retains
its established canonical ID and demonstrates the existing converter through the normal executor.
