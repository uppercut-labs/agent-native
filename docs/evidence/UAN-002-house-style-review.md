# UAN-002 house TypeScript style review

Reviewed 2026-10-10 against the owner's [TypeScript house guide](https://starter.devthomas.site/style/TypeScript) (version 1.0.0, updated 2026-09-23). The scope was all owned TypeScript in `src/` (about 6,900 lines). The examples contain no `.ts`/`.tsx` sources: their callbacks are `.mjs` with JSDoc types, which this TypeScript-only guide does not cover. The emitted Astro `export default defineConfig(...)` template in `src/init.ts` is third-party framework output and stays as Astro requires.

## Deviations found and changed

| Guide rule | Before | After |
| --- | --- | --- |
| Maximum practical compiler strictness | `noImplicitReturns` missing from the baseline | Added to `tsconfig.json`; no errors resulted |
| Avoid lint rules that rewrite intentional `let` | Biome `recommended` enabled `style/useConst` | `style/useConst` is off. `complexity/useLiteralKeys` is also off, because it contradicts `noPropertyAccessFromIndexSignature` bracket access. The rest of `recommended` remains |
| `const` means immutable; `let` means mutable | Collections were held in `const` bindings and then pushed to or set | Mutated bindings use `let`. Never-mutated ones keep `const` with `readonly T[]`, `ReadonlySet`, `ReadonlyMap` or `Readonly<Record<…>>` |
| No non-null assertions | 10 postfix `!` in `src/init.ts` | Replaced with visible `requireAt`/`requireValue` helpers. Each value was already established, so behavior is unchanged |
| Shared `assertNever` | Owned-union switches over execution failures and harness events had no compile-time exhaustiveness | `src/core/assert-never.ts` (internal) closes the switches in `http.ts`, `mcp.ts` and `browser.ts`. `harness.ts` uses a local `never` guard that keeps its `HarnessError` for untrusted input |
| Explicit types by default; explicit callback types | Locals, callbacks, default-valued parameters and some helpers relied on inference | About 460 locals were annotated with the types tsc inferred, plus callback parameters and returns, default-valued parameters and class fields. Async functions declare `Promise<T>`, and `runTurn` declares its `AsyncGenerator` type. A few internal aliases name repeated shapes |
| `interface` for implementation contracts | `HarnessMcpBridge`, `BrowserCapabilityAdapter`, `WebMcpModelContext`, `NextBrowserBootstrap` and `McpAppRegistration` were object `type`s | Now interfaces. This is structural and source-compatible for consumers |

The emitted declaration files were compared with a build of the previous source. Exported names, signatures and value types are unchanged apart from equivalent spellings.

## Deliberate exceptions

- `PACKAGE_VERSION` stays unannotated because `scripts/check-package-version.mjs` matches that exact line.
- `DOCTOR_REPORT_SCHEMA_VERSION` and `DOCTOR_REPORT_JSON_SCHEMA` keep their inferred types. Annotating them would change exported literal types.
- `as const`/`satisfies` precision sites stay as they are, which the guide allows.
- `HarnessEvent` is a released public union discriminated by `type` rather than `kind`. Renaming it would break the 0.1.1 API, so it is left for a future major version.
- Remaining `void promise.catch(handler)` calls use handlers that cannot throw, which the guide accepts.

## Verification

`npm run format:check`, `npm run lint`, `npm run typecheck` (all three tsconfig projects), `npm run build:browser-proof` and the full unit suite pass. That includes 124 non-harness tests and 6/6 Codex harness tests. The full `npm run check` and the isolated-export check repeat these on the committed source.
