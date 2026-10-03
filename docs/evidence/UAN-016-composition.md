# UAN-016 composition evidence

## Scope

The implementation adds contract-only capability packs, explicit alias policy, stable
authority/namespace composition, source-located conflict diagnostics, and shared deterministic
HTTP/CLI/MCP/OpenAPI name mapping. Runtime execution still uses `executeCapability` and the existing
registry/binding types.

The exported E08 fixture contains a separately versioned `@example/e08-distance-contracts` package.
Two consumer modules bind its single imported definition. Its tests cover distinct provider results,
an authorization denial where the handler is not selected, a deliberately duplicated full identity,
and an ESM load trace that rejects executor, registry, HTTP, MCP, Zod, or provider loading during a
contract-only import.

## Reproduction

Use the required Node release from the repository root:

```sh
export PATH=/Users/research/.nvm/versions/node/v24.18.0/bin:$PATH
npm run typecheck
npm run lint
npm run format:check
node --test test/composition.test.mjs test/executor.test.mjs test/public-exports.test.mjs
node --test --test-name-pattern='operation identifiers|tool naming' test/http.test.mjs test/mcp.test.mjs
npm run example:e08
npm run example:e12
```

Observed in the Codex CLI sandbox with Node 24.18.0: typecheck, focused lint/format, browser proof,
and build passed; the two focused root test commands passed 16/16 and 2/2; E12's direct project
tests passed 5/5. E08's tests passed 3/3 in an equivalent local package-link staging directory and
its demo returned `30.48 cm` from `precise-consumer`. The CLI sandbox blocked the standalone
`npm run example:e08` install because package network access was unavailable.

An independent plain-SSH run on the same isolated clone completed `npm run example:e08`: the SDK and
contract were packed separately, both tarballs installed in `.exported`, all four E08 tests passed,
and the demo returned `30.48 cm` from `precise-consumer`. The standalone install reported zero
vulnerabilities. The tests check matching conversion values from both consumer bindings and invoke
each consumer entrypoint in an independent process. E12's established canonical ID remained
unchanged. `npm run typecheck` and a scoped Biome check also passed after this review.

## Limits

- Pack metadata is local application data; there is no remote registry, signature verification, or
  package provenance attestation.
- FNV-1a is a deterministic name qualifier, not a security primitive. Composition and adapter setup
  still check generated names for collisions rather than assuming the digest is unique.
- Aliases are local lookup conveniences and do not change canonical IDs or transport routes.
- Composition neither elevates permissions nor establishes transaction semantics.
- This work does not implement v2 migration or compatibility negotiation; that is UAN-017 scope.
