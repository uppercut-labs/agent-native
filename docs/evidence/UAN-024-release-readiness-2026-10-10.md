# UAN-024 release-readiness update (2026-10-10)

This page supersedes the open rows in the [2026-10-03 snapshot](UAN-024-release-readiness.md), which stays as a dated record. The package is published as `0.1.1`. Every UAN acceptance item now has evidence or a recorded scope limit.

## Closed since the earlier snapshot

| Earlier open item | Current evidence |
| --- | --- |
| UAN-020 vulnerability contact and support limits | GitHub private vulnerability reporting is enabled ([release handoff](../release-handoff.md)). Limits are in [support limits](../support-and-limitations.md) and the [operational failure-safety evidence](UAN-020-operational-failure-safety.md) |
| UAN-021/023 rendered MCP Apps, clean-context adoption and native WebMCP | [Inspector MCP Apps and Astro adoption](UAN-023-inspector-web-and-astro-adoption.md) and [native Chrome 155 WebMCP](UAN-023-native-webmcp-chrome.md) |
| UAN-022 Windows/Linux CLI, timing and license inventory | [Portability](UAN-022-package-portability.md), [overhead](UAN-022-overhead-license-audit.md) and the [cross-platform license and notice review](UAN-022-cross-platform-license-notices.md) |
| Astro advisory | [2026-10-10 recheck](GHSA-ch52-4w7c-c8xp-2026-10-10.md): disputed upstream with no fix; Astro does not call the affected method |
| Final candidate artifact | The `0.1.1` registry tarball (SHA-256 `a1ce884f…8fbb`) matches the reviewed archive for source `ab79aed`, and a clean registry install passed ([harness release evidence](codex-harness.md#registry-release---2026-10-05)) |
| UAN-002 house style | [House TypeScript style review](UAN-002-house-style-review.md) |
| UAN-018 converter parity | E12 now has local, browser and server bindings. Its HTTP route returns the same results as the local and browser bindings, and invalid input returns 422 |
| UAN-021 exports outside workspace paths | `npm run check:isolated-examples` copies every exported example to a temporary directory outside the repository. It confirms there is no `node_modules` above that directory and that the package resolves to the copy's own install. It then runs `npm ci` and the example's checks there. All twelve passed locally, and CI runs it on Node 24 |
| UAN-023 flagship CLI from one definition | E04's application-owned CLI reuses the shared E01 contract and calls the sidecar remotely. Together, E01, E04 and E09 give the flagship browser, HTTP/OpenAPI, MCP, CLI and MCP Apps surfaces from one definition |

## Acceptance row ledger

| Row | Evidence | Disposition |
| --- | --- | --- |
| A19 sidecar routing and revision | Packed E04 route, origin, revision and protocol checks on local workerd | Passed locally. A live provider address and rollback belong to the deploying application |
| A23 docs/example coverage | The coverage manifest, source-region and link checks, and isolated example exports | Passed |
| A26 provider provisioning guard | Init plans only local edits and never provisions | Passed |
| A27 real-host compatibility | Inspector 2.8.0 MCP Apps, and Chrome 155 native WebMCP with the opt-in feature | Passed for named hosts. Commercial MCP hosts and shipping browser agents are unverified and not claimed |
| A28 independent checks | Node 22/24 CI on every pushed commit | Passed |
| A29 packed install | The 0.1.1 registry install, and examples installed outside the repository | Passed |
| A30 CLI platform smoke | macOS and Linux CI packed CLI, plus the Windows packed CLI in a path with spaces | Passed |

## Not claimed

Native WebMCP in default browsers, commercial MCP or MCP Apps hosts, provider deployments, and external identity providers. The `consequentialHint` and style changes are listed as unreleased in the changelog, and no npm version was published for them.
