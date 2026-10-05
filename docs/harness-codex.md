# Codex local harness

The isolated `@uppercut-labs/agent-native/harness/codex` export controls an installed
Codex CLI app-server over stdio. It needs Node 22+ built-ins and a caller-installed
Codex executable, with no provider SDK dependency. Importing the export or creating
the adapter starts no process or inference. These additions require version 0.1.1. Use the versioned installation route in
[installation](installation.md); 0.1.0 does not include this adapter.

## Authentication and model selection

Use `codex login` and complete Codex's managed ChatGPT sign-in. The adapter checks
`account/read` with `refreshToken: false` before creating/resuming a thread and
requires account type `chatgpt` and the provider's `requiresOpenaiAuth` flag. Codex owns credential storage and renewal. Do not
pass a token, copy authentication files, or log account responses.

This route uses the eligible ChatGPT-plan Codex path. It does not require an OpenAI
Platform API key, use the OpenAI Agents API, or implement external OAuth token
injection. API-key accounts are rejected with `authentication-required`; there is
no automatic API-billed fallback. Account eligibility, usage limits and model
availability still belong to the provider. See [official authentication guidance](https://developers.openai.com/codex/auth/).

Select `model` explicitly; the adapter never substitutes another model. `effort`
defaults to `low` and may be `low`, `medium`, `high`, `xhigh`, or `max` when the selected
model supports it. The real acceptance fixture used the installed runtime's
`gpt-5.6-luna` catalog entry; this is tested evidence, not a latest-model claim.

## Lifecycle

```ts
import { createCodexHarnessAdapter } from '@uppercut-labs/agent-native/harness/codex';

const adapter = createCodexHarnessAdapter({ model: 'gpt-5.6-luna' });
const workspace = '/absolute/path/to/disposable-workspace';
const session = await adapter.openSession({ target: 'local', workspace });
try {
  for await (const event of adapter.runTurn({ session, prompt: 'Create a small example.' })) {
    // Render normalized events; do not publish the opaque session/turn IDs.
  }
} finally {
  await adapter.closeSession({ session });
}
```

`describe()` advertises local-only support with `resume`, `cancel`, and `usage`.
Cloud open/resume is rejected. Local workspaces must be existing absolute directories;
the adapter canonicalizes them and rejects resume into a different directory.
The app-server's `thread.id` is preserved as the opaque session ID. Resume reads
the persisted thread's workspace before `thread/resume`, checks the returned ID
and directory, and can reattach through a new adapter/process after close.

Each session owns one app-server process. It initializes the protocol connection,
acknowledges `initialized`, checks managed login, and starts/resumes the thread
with the explicitly selected model and `openai` provider. The sandbox defaults
to `workspace-write`; `read-only` is also supported. No full-access option is exposed.
Noninteractive approval policy is `never`; unexpected command/file approval requests
are explicitly declined, MCP elicitations are declined, and other interactive
requests receive a fixed unsupported response. The adapter never grants extra
permissions. Codex's existing user/project configuration, skills, plugins, rules,
and MCP settings still apply; this is not an empty provider configuration.

`runTurn` sends one text input to `turn/start`, yields `turn-started`, then streams
normalized tool/usage events and a terminal result. Only provider status `completed`
produces `completed`; `interrupted` becomes `cancelled`, and failed/unknown terminal
status becomes `failed`. Unauthorized terminal failures map to
`authentication-required`. Raw model deltas, arguments, commands, diffs, reasoning,
account details, stderr and provider exceptions are never forwarded.

Token usage events project `tokenUsage.last.totalTokens` as nonnegative safe-integer
snapshots. Several updates can occur in one turn; do not sum snapshots as a cost
estimate. Missing usage remains unavailable. A session allows only one active turn;
resume and overlapping turns are rejected until its stream is consumed/closed.
`cancelTurn` checks the exact active turn ID and sends `turn/interrupt`.

## Bounds and cleanup

`requestTimeoutMs` defaults to 30000 (1-300000). `turnTimeoutMs` defaults to 180000
(1-3600000) and stops on the provider's terminal notification, even if a consumer
is still rendering queued events. Prompt size is limited to 65536 characters.
The transport bounds its unparsed buffer to 2,097,152 UTF-16 code units and the normalized queue to 256
events. Malformed protocol, process exit and exhausted bounds cannot imply success.

`closeSession` is idempotent for a known session. It closes only the adapter-owned
stdin/process, waits `shutdownTimeoutMs` (default 2000, range 1-10000), then signals
that child PID with SIGTERM and finally SIGKILL if needed. Each wait is bounded;
cleanup failure is surfaced. No process-name search or unrelated-process kill is
used. Close releases runtime resources; it does not erase Codex's persisted thread.
Abandoning a turn stream also closes its owned runtime. Consume streams and close
sessions in `finally` so resources are released promptly.

`executable` defaults to `codex` on the caller's PATH; `executableArgs` optionally
selects a trusted launcher prefix. The adapter does not install a CLI or change
global configuration. A missing executable raises `CodexHarnessError` with
`provider-unavailable` and fixed installation guidance; missing/alternate auth has
fixed `codex login` guidance. Other failures use the neutral stable reasons.

## MCP boundary and acceptance

Capability execution remains a separate authorized application plane. This adapter
does not expose a programmatic MCP-configuration API and does not advertise `mcp`.
Existing Codex MCP configuration follows the application's own authorization.
The [loopback helper](harness-mcp-bridge.md) does not grant application permissions
and cannot serve cloud agents through an implicit public tunnel.

Provider-free tests cover thread mapping, cross-process resume, unavailable runtime,
wrong auth, malformed/timeout responses, stream failures, targeted interrupt, concurrent
turns, workspace mismatch, permission rejection and bounded owned cleanup.
To deliberately opt into real inference in a disposable workspace:

```sh
npm run proof:codex -- --model gpt-5.6-luna
```

The proof verifies `hello world`, closes the first process, resumes the same thread
in a new process, then verifies `hello Codex`. It prints only normalized evidence
and removes its temporary workspace. Regular checks never launch real inference.
See [version evidence](evidence/codex-harness.md) and the
[official app-server protocol](https://developers.openai.com/codex/app-server/).
