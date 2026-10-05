# Programmatic harness contracts

The isolated `@uppercut-labs/agent-native/harness` export defines a provider-neutral
Session -> Turns control plane without runtime dependencies. This initial slice
includes fake-adapter acceptance; provider adapters and the MCP bridge are future work.
It does not launch a provider or claim real-provider acceptance.

Harness control and capability execution are sibling planes. Starting an agent
never grants permission to invoke application capabilities. The existing
[capability executor](capabilities-and-bindings.md) and [MCP authorization](mcp.md)
remain authoritative. A future local bridge must bind only to loopback; cloud
configuration must explicitly supply a reachable authenticated endpoint.

## Lifecycle

`ProgrammaticHarnessAdapter` exposes `describe`, `openSession`, `resumeSession`,
`runTurn`, `cancelTurn`, and `closeSession`.

- Call `describe()` before use. Its provider, targets (`local`/`cloud`), and features
  (`resume`, `cancel`, `usage`, `mcp`) describe actual support.
  `assertHarnessSupport(descriptor, target, feature?)` raises stable typed failures.
  Adapters must also check support; negotiation is not authorization.
- Local open/resume requests require an explicit workspace. Cloud requests carry
  only the target; the provider factory must require explicit remote/repository and
  authentication configuration. No local workspace is implicitly uploaded.
- `HarnessSessionRef` contains provider, target, and an opaque session ID. Resume
  receives this complete reference plus target/workspace. IDs are preserved verbatim;
  no parsing, cross-provider migration, or global lookup is implied.
- `runTurn({ session, prompt })` yields `turn-started` with an opaque turn ID,
  optional status/tool/usage events, then exactly one terminal event: `completed`,
  `failed`, or `cancelled`. A rejected start throws `HarnessError`.
  A stream ending without a terminal event is incomplete, never successful.
- `cancelTurn({ session, turnId })` targets one active turn and requires `cancel`.
  `closeSession({ session })` releases only adapter-owned resources and is idempotent
  for a known closed session. It does not imply deleting provider history.
  Adapters define whether resume can reattach after local resource cleanup.

Adapters validate provider/target identity, workspace ownership, session state,
and concurrent-turn restrictions. Core contracts do not execute capabilities or
weaken provider permissions.

## Events and failures

`HarnessEvent` is a closed union: `session-started`, `turn-started`, `progress`,
`tool`, `usage`, `completed`, `failed`, `cancelled`.
`createHarnessEvent` constructs immutable snapshots, projects out extra provider
fields, and validates normalized payloads. `createHarnessStatusEvent` is the focused
status/tool helper. Message length is 1-240 characters, provider length 1-64,
session ID length 1-1024, and turn ID length 1-128; control characters are rejected.
These limits bound individual events, not total stream length. Consumers must apply
their own turn deadlines and event-count limits.

Status/tool messages must be adapter-authored, reviewed safe summaries. Length checks
and field projection do not detect credentials embedded in an allowed string.
Never forward raw model output, exception text, environment dumps, credential files,
or tool arguments. Treat session IDs as sensitive in external evidence unless provider
guidance explicitly permits sharing them.

Usage is a nonnegative safe integer in provider-reported `tokens` or `requests`.
Emit it only when advertised and reliable; absence means unavailable, not zero.
It is not a cross-provider price model.

`HarnessError.reason` is one of `unsupported-target`, `unsupported-feature`,
`invalid-request`, `authentication-required`, `provider-unavailable`,
`session-not-found`, `session-closed`, `turn-not-found`, `turn-active`, `timeout`,
`provider-failed`. Messages are fixed by reason and carry no raw provider cause.
Terminal failure events use these same reasons. Adapters translate provider failures
at the boundary; restricted diagnostics stay outside this normalized API.

## Acceptance and installation

`test/harness.test.mjs` checks a fake adapter opening a session, two turns with
same-session resume, targeted cancellation, close, unsupported operations, stream
failures, event bounds, and raw-field exclusion. Type checks reject local requests
without a workspace. `npm run check:portability` packs and installs a fresh
root/browser/harness consumer with optional peers absent and checks every export.

The export is not re-exported from root/core and has no provider SDK, Node, DOM,
framework, or MCP imports. Import contracts through `/harness`.
Source/tarball checks do not establish availability of a new registry release.
