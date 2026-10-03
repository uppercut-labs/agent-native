# Composition and versioning

Reusable capability packs distribute contracts, not providers. A pack owns an authority and a
namespace; its definitions use the combined namespace `<authority>.<namespace>`. Definitions remain
ordinary `CapabilityDefinition` values, and a consumer binds the exact definition it implements.
Composition does not wrap handlers, grant scopes, or create a privileged execution path.

## Exact major selection and aliases

`majorVersion` is part of the canonical identity. A pack can therefore export v1 and v2 together,
and `composeCapabilityPacks()` keeps both definitions. Select a major with its full identity:

```js
const v2 = composition.select({
  namespace: 'example.org.catalog',
  name: 'album.lookup',
  majorVersion: 2,
});
```

`composition.resolve()` accepts either a canonical ID or an explicitly configured alias. Every
import must choose `{ kind: 'none' }` or `{ kind: 'explicit', aliases: [...] }`. An alias stores one
full canonical ID; it never means "latest" and never falls forward. Thus an `album-v1` alias that
targets `example.org.catalog:album.lookup@1` continues to select v1 when v2 is installed. Missing
targets, duplicate aliases, and duplicate canonical identities fail composition with source
locations.

## Contract migration reports

`compareCapabilityDefinitions(previous, next)` returns a structural report over input and output
JSON Schema plus risk, access, and HTTP/CLI surface metadata. Reports identify paths and before/after values for
property additions/removals, likely one-to-one property renames, required-field changes, defaults,
unit annotations such as `x-unit`, and other represented schema values. Rename detection is a
structural aid, not proof of author intent.

`assertCompatibleCapabilityReplacement(previous, next)` is for an unchanged canonical identity. It
allows an implementation or description change when input/output schemas and risk/access metadata
remain compatible. It rejects a breaking definition replacement, so a v1 ID cannot silently acquire
v2 requirements or output shape.

For a new major, use `defineCapabilityMigration({ previous, next, semanticReview })`. The semantic
note and named reviewer are mandatory even when the two schemas are identical. JSON Schema can show
represented structural changes; it cannot prove behavioral equivalence, units outside the schema,
side effects, ordering, freshness, or other semantics. A pack that contains multiple majors of one
capability family must attach the reviewed adjacent-major migrations and lifecycle policy; pack
definition fails when either is missing.

## Deprecation and removal

Lifecycle is application policy, not npm semver inference. `defineCapabilityLifecyclePolicy()`
records each canonical major as `supported`, `deprecated`, or `removed`. Deprecation needs an
operator-facing note. Removal needs a note and reviewer.

`validateCapabilityPackMigration()` compares an earlier pack to a later pack. It checks unchanged
IDs with the replacement guard, requires reviewed migration records for added majors of an existing
capability family, and reports additions/removals. A supported major cannot disappear implicitly. A
major may be removed only when the previous policy already marked it deprecated and the new policy
records an explicit reviewed removal. Package version changes do not alter these states.

## Generated surfaces

`capabilitySurfaceNames(identity)` maps each exact major identity deterministically:

| Surface | Mapping |
| --- | --- |
| CLI | `<namespace>:<name>@<major>` |
| HTTP | `/capabilities/<namespace>/<name>/v<major>/invoke` |
| MCP | length-encoded `cap_..._v<major>` tool name |
| OpenAPI | length-encoded `invoke_..._v<major>` operation ID |

HTTP segments are encoded separately. MCP names over 128 characters receive a visible
`_fnv1a64_<digest>` qualifier rather than silent truncation. Aliases are composition lookup names;
they do not replace canonical CLI IDs, HTTP paths, MCP names, or OpenAPI operations. Adapters expose
only definitions present in the registry and keep their existing authorization/discovery policies.

Run `npm run example:e08` for the independently installed contract-only package. It exports v1 and
v2 album lookup contracts, keeps a stable v1 alias, uses two consumer bindings, checks old/new output
fixtures, and exercises migration failures. E12 retains its established canonical unit-converter ID.
