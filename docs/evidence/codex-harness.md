# Codex harness evidence

Checked 2026-10-04 (America/Chicago), with the real proof completed at
`2026-10-05T03:50:19.168Z`; fresh-tarball inference passed at
`2026-10-05T03:56:16.489Z`. This records one local runtime/model route, not all CLI
versions, accounts, models or cloud targets.

| Component | Tested value |
| --- | --- |
| Local Node | 24.18.0; package floor Node 22 |
| Codex CLI/app-server | 0.145.0, stdio transport |
| Authentication | Codex-managed ChatGPT sign-in; no Platform API-key fallback |
| Model | gpt-5.6-luna, selected from this runtime's model/list catalog |
| Effort | low |
| Sandbox | workspace-write, disposable local directory |
| Result | Both exact file checks passed; same thread resumed through a new process |
| Cleanup | Both owned app-server processes closed; temporary workspace removed |

Generated protocol schemas from the installed CLI were inspected before implementation.
Official sources: [app-server](https://developers.openai.com/codex/app-server/) and
[authentication](https://developers.openai.com/codex/auth/). The adapter uses managed
CLI login rather than application-owned external token injection. No identity,
plan detail, session ID, credential or raw provider transcript is included here.

The real proof created `proof.txt` with `hello world`, closed the original process,
read/resumed the same persisted thread in another process and changed the file to
`hello Codex`. File contents and resume identity were verified by the runner, rather
than inferred from model output. Usage updates were snapshots, not billed-cost evidence.
The opt-in runner is `npm run proof:codex -- --model gpt-5.6-luna`; regular package
checks use synthetic protocol processes only.

Fresh packed-consumer acceptance verifies all export targets exist and imports
root/browser/harness/bridge/Codex without optional SDKs. Its missing-runtime probe
checks actionable guidance without launching inference. Provider fixtures test
interrupt, failures, wrong auth, malformed protocol, deadlines, concurrent turns,
workspace ownership, cross-process resume, permission denial and owned cleanup.

This is source/tarball evidence for the additions under review, not confirmation of
a new npm release. Cursor local/cloud acceptance is pending. Codex programmatic
MCP configuration and cloud operation are not advertised by this adapter.
