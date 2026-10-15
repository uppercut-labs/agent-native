# Recovery and executor-selection recipes

Verified October 15, 2026 against the Agent Native 1.0.1 implementation. These
application examples extend E07 and E11 without changing package runtime code,
stable declarations, transport envelopes, tool naming or authorization policy.

## Protected write recovery

E07's `src/recovery.mjs` defines a protected write and protected status read. The
application reserves an idempotency key scoped to subject and tenant in a local
file journal. Its write deliberately ignores abort and waits for a deferred
commit. The test advances the adapter deadline with Node mock timers, observes
the existing uncertain-write warning and one handler invocation, then reads
pending status. Releasing the original write produces committed status and one
persisted commit. Reopening the journal retains that state.

Negative paths cover missing status, an unauthorized reader, an explicitly
resubmitted matching key while pending and committed, and a conflicting value.
Explicit duplicate requests do not create another mutation. Sentinel assertions
check that the timeout and denied read expose no protected value. The demo makes
only one write invocation, reconciling its outcome through status reads.

## Exact selection and private diagnostics

E11's `src/executor-selection.mjs` distinguishes `invalid-identity`,
`capability-missing`, `binding-unavailable` and `binding-ambiguous` before any
handler runs. Explicit `bindingId: 'primary'` invokes one binding with separate
namespace, name and major-version fields.

The same executable uses the official MCP client/server SDKs with an in-process
fetch transport. Its operator hook receives `handler-failed` and `invalid-output`
with diagnostic observations. The client receives the existing bounded error.
Neither operator events nor client results contain credential, input, output or
exception sentinels. Hidden tools cannot be listed or called, and generated tool
names remain distinct for separator-bearing identity pairs.

## Verification

On macOS with Node 26.9.0 and npm 11.19.1:

- `npm run check` passed: 136 library tests, format/lint/type checks, API baseline,
  browser proof, all twelve standalone exports, docs, portability and adoption.
- After strengthening the no-retry counter assertion, `npm run example:e07`,
  `npm run format:check`, `npm run lint` and `npm run docs:check` passed again.
- `npm run check:isolated-examples -- e07-playlist-permissions e11-diagnostics-fault-lab`
  passed independent installs, example tests and both executable demos outside
  the repository, without ancestor dependencies.
- The three new recipe tests passed against installed tarballs on Node 22.23.3
  and 24.22.0 using `npm exec --package=node@22 -- node --test` and the equivalent
  Node 24 command, with the exported E07 recovery and E11 selection test paths.

The existing root CI runs the exports on Node 22 and 24. The isolated runner also
executes both demos. Source-backed snippets in the guides are checked for drift.

## Limits

The file journal is a single-process fixture, not a production database or a
cross-process/crash-safe transaction protocol. A real application owns operation
identity, persistence, key retention, reconciliation and recovery. Missing or
pending status does not authorize blind replay. No exactly-once guarantee or
rollback on timeout is supplied by Agent Native. No paid model trials, model
efficacy measurement, commercial host verification or production deployment is
claimed by these deterministic checks.
