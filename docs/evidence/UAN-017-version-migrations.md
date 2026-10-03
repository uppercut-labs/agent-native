# UAN-017 version migration evidence

## Scope

The portable composition entrypoint now provides exact-major selection, stable explicit aliases,
structural definition comparisons, same-ID breaking replacement rejection, reviewed major migration
records, explicit lifecycle policy, and guarded pack migration validation. It does not import
handlers or runtime adapters.

E08 independently packs a contract-only album package containing v1 and v2. Its old binding uses the
shared internal data lookup while retaining the single-title output. Its new binding requires locale
and returns localized titles. JSON fixtures lock both shapes.

## Reproduction

From the repository root:

```sh
npm run build
node --test test/composition.test.mjs test/public-exports.test.mjs
npm run typecheck
npm run lint
npm run format:check
npm run example:e08
```

The E08 suite checks exact selection and alias stability, distinct outputs, structural default/unit,
rename and required-field reporting, mandatory semantic review for schema-identical majors,
same-identity replacement rejection, implicit retirement rejection, independent consumer processes,
and the contract-only import boundary.

Observed on `research` (Darwin arm64, Node 24.18.0, npm 11.16.0): typecheck, format check, build,
and focused lint exited successfully after the final review fixes. The full lint had exited
successfully before those fixes. The focused composition/public-export suite passed 14/14. Biome
reported non-fatal style suggestions in the schema-diff code. The standalone E08 harness
packed and installed both packages from tarballs, passed 9/9 tests with zero audited vulnerabilities
in that exported fixture, and returned the v1 `Kind of Blue` output. `git diff --check` passed.

The post-review tests reject a spoofed pack authority, a structural multi-major pack without
reviewed migration policy, forged semantic/contract reports, a new property in a closed v1 output
schema under the same ID, and fake lifecycle `get()` claims without matching entries. E03's
lockfile export fix and E12's canonical ID remain untouched. A full repository suite was not rerun
for this focused slice.

## Limits

- Structural comparison reports only information represented in JSON Schema and risk/access metadata.
- Rename detection matches a unique removed/added property with identical structure; review determines intent.
- Lifecycle policy is local application metadata; no remote registry or package signature is provided.
- Removal validation enforces a prior deprecated state but does not schedule retention or notify consumers.
