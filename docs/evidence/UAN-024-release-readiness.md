# UAN-024 release-readiness audit update

Snapshot: 2026-10-03 07:05 UTC, public source `79f7e4ea8324ed616d83c04715a1eaf4dd175144`. This note updates the earlier isolated audit at `8a502b5`; it does not certify a release or include later commits. No package version/visibility, npm registry, provider deployment, or DNS state was changed for this update.

## Confirmed repairs

| Earlier finding | Current observation at this snapshot |
| --- | --- |
| A clean pack omitted `dist` and all 36 export targets. | `fc4e4e2` added `prepack: npm run build`. A separate clean clone of `79f7e4e` ran `npm ci` then normal `npm pack --dry-run --json` and reported 124 files, a 127,308-byte tarball and 36/36 declared export target paths. This is a dry-run file-list check, not an immutable release tarball or digest. |
| The Worker E04 MCP path returned HTTP 500. | `24c8bab` gives the Workerd JSON Schema validator a mutable copy before it annotates schemas. A fresh packed E04 run passed its nine fixture tests, bundle/host/origin/CORS checks and official MCP client roundtrip. |
| Integration CI was red. | [Run 37104609091](https://github.com/uppercut-labs/agent-native/actions/runs/37104609091) passed `npm run check` and `npm pack --dry-run --json` in both Node 22 and Node 24 jobs for the exact `79f7e4e` SHA. This is the broad integration result; no duplicate full suite was run for this documentation update. |

The manifest names `@uppercut-labs/agent-native`, points to the public Uppercut Labs repository, and declares MIT; [LICENSE](../../LICENSE) credits Devin Thomas. `npm view @uppercut-labs/agent-native version --registry https://registry.npmjs.org/` returned E404 on 2026-10-03 07:04 UTC. That response means the target is not publicly readable at that moment; it does not reserve the name or prove publish permissions. The manifest remains `private: true` at `0.0.0`.

## Evidence still needed for v1 acceptance

1. **Complete UAN-020.** The [negative security fixtures](UAN-020-negative-security-fixtures.md) and later failure-safety work are valuable local evidence. A maintainer-approved private vulnerability contact is still absent from [SECURITY.md](../../SECURITY.md). Provider auth, grant persistence, cache isolation, CSP/iframe behavior and timeout handling need their exact supported boundaries recorded.
2. **Complete UAN-021/023 documentation and real-host evidence.** The [coverage manifest](../../docs-site/coverage.json) links E01-E12 to guides and negative probes, while the [named Inspector CLI probe](UAN-023-inspector-host-probe.md) proves a real Streamable HTTP client, not rendered MCP Apps interaction. Clean-context Astro adoption and native WebMCP host behavior remain open at this snapshot. The default Chrome probe did not expose `document.modelContext`.
3. **Complete UAN-022 portability.** [Measured macOS package evidence](UAN-022-package-portability.md) and the green Linux CI matrix cover several pieces. Windows/Linux representative installed CLI use, cold doctor/invocation timing, license inventory and consumer bundle budgets need a final support decision. A CI runner is not a Windows or production provider host.
4. **Assess the Astro dependency advisory.** The lockfile resolves `astro@7.3.5` and `http-cache-semantics@4.2.0`. [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) lists versions through 4.2.0 as affected and no patched version as of this snapshot; `npm view http-cache-semantics version` returned 4.2.0. The earlier `npm audit --omit=dev --audit-level=high` found no production dependency vulnerability. Decide and document impact/mitigation for the Astro integration path before claiming a hosted support tier.
5. **Make a final candidate artifact and provider record.** The dry-run file list and CI do not supply a tarball digest, dependency license report, published version, registry install, or live deployment. Use the [release and provider handoff](../release-handoff.md) after the remaining gates pass. The package has no `bin` entry or package-level `init` command; a programmatic v1 scope would need an explicit acceptance decision.

## Acceptance row ledger

The internal acceptance matrix is planning context; these public results are scoped to the cited source snapshot.

| Row | Current evidence | Release disposition |
| --- | --- | --- |
| A19 sidecar routing and revision (R21) | Packed E04 route, origin and protocol fixture passed. | Live provider address and rollback remain unverified. |
| A23 docs/example coverage (R18) | Coverage manifest resolves twelve examples; the current docs build checks links. | Guide prerequisites, expected output and independent adoption review remain open. |
| A26 provider provisioning guard (R21) | Programmatic init plans local project edits and does not provision an account. | Provider handoff remains an application operation. |
| A27 real-host compatibility (R22) | Named Inspector CLI 2.8.0 exchanged MCP requests. | Rendered MCP Apps and native WebMCP host behavior remain open. |
| A28 independent checks (R23) | Node 22/24 CI passed on this SHA. | Re-run once on the final release candidate SHA. |
| A29 packed install (R24) | Existing examples and core/browser portability check use fresh local tarballs; clean pack contains all exports. | Final immutable candidate and outside-repository release install remain open. |
| A30 CLI platform smoke (R24) | macOS Node/Hono CLI fixture passed; Linux CI runs examples. | Representative Windows/Linux installed CLI invocation remains open. |

## Documentation output in this slice

[CHANGELOG.md](../../CHANGELOG.md) records unreleased work and states there is no prior npm migration path. [CONTRIBUTING.md](../../CONTRIBUTING.md) describes scoped verification and private-data handling. The [release handoff](../release-handoff.md) maps package release steps and application-owned native-provider work without inventing a hosted service or a support address.

This is a release preparation checkpoint. UAN-024 remains open until all mandatory evidence is complete or a specific unsupported scope is explicitly accepted by the maintainer, and the final artifact is tied to a source commit.
