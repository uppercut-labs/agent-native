# Release and provider handoff

This is a preparation record for the unreleased `0.0.0` source package. The public source is [uppercut-labs/agent-native](https://github.com/uppercut-labs/agent-native); `@uppercut-labs/agent-native` is the intended npm name and MIT is the selected license. The package manifest remains private. See [UAN-024 release evidence](evidence/UAN-024-release-readiness.md) for a dated verification snapshot.

## Package release sequence

1. Close the evidence gates listed below and run the current Node 22/24 CI matrix on the exact candidate commit. Treat each example's negative probe and independent tarball install as part of that gate.
2. From a clean checkout of that same commit, install with `npm ci`, run `npm pack --dry-run --json`, and inspect the resulting file list against every declared `exports` target. The `prepack` script builds `dist`; a dry run with scripts disabled is not the publish path.
3. Review the tarball itself, its license, README, documentation, package metadata, dependency licenses, and production audit. Record a SHA-256 digest, package file count/size, exact source SHA, and the Node/npm versions used. Install that artifact in a clean consumer for the supported entrypoints.
4. After release acceptance, set an approved version and remove `private: true` in a scoped change. Run the exact final checks on that change, then publish under the organization scope with public access. Record the registry URL and digest. Keep the source tag and registry artifact tied to the same commit.
5. Perform a post-publish clean install and the documented first-run path. If publication or provenance verification fails, report the actual registry state and recovery action; never describe a local tarball as a published npm release.

No version change, npm publish, or production deployment is performed by this handoff. The package has no `bin` entry; users currently call its programmatic APIs or application-owned CLI runner. Do not advertise `npx agent-native init` until an executable exists and is tested.

## Native provider deployment

Agent Native supplies contracts and adapters, not a managed hosting account. The deploying application owns its provider resources and operational policy:

| Surface | Application-owned deployment work | Minimum live evidence |
| --- | --- | --- |
| Static Astro plus Worker sidecar (E01/E04) | Choose the sidecar origin, provision the Worker and routes, configure allowed Host/Origin/CORS and revision matching, bind secrets outside source control, and keep the static site independent. | Public and denied routes, cross-origin denial, OpenAPI and MCP client roundtrip through the deployed address, rollback of Worker and routing. |
| Astro on-demand (E02) or Next App Router (E03) | Provide a supported server runtime, own endpoint mounting and framework adapter, deploy the site and server together, and verify static/prerendered pages remain correct. | HTTP and MCP calls, auth/denial, framework build, navigation and rollback at the real deployment. |
| Node/Hono or another server (E05) | Own the process, TLS/front proxy, route path, limits, logs, credentials and restart behavior. | Local and remote CLI parity through the deployed endpoint, malformed input, auth denial and health evidence. |
| Browser and MCP Apps (E06/E09) | Choose an actual host with the needed API, obtain host consent, set resource CSP/sandbox policy, and keep server credentials out of browser assets. | Named host version and origin, visible tool registration and action, denied call, iframe/CSP behavior, cleanup after navigation. |

For protected capabilities, the application must provide token verification, issuer/audience/scope policy, resource authorization, a durable grant store, revocation consistency, idempotency for mutations, and incident response. A timeout can leave a write's completion uncertain; do not retry it blindly. The local E07 grant fixture and E11 doctor profile are examples, not production identity or persistence services. Record provider account owner, deployment ID, route/DNS owner, secret storage location (never the secret), rollback command, log/trace location, and the person who accepts live behavior in the deployment runbook.

## Open acceptance gates

- [ ] UAN-020 security/failure-safety review and approved private vulnerability reporting contact are complete.
- [ ] UAN-021 guides and every E01-E12 example have checked prerequisites, expected output, a negative path, and source-backed evidence.
- [ ] UAN-022 Windows and Linux representative install/CLI behavior, dependency license inventory, and overhead measurements have a recorded decision.
- [ ] UAN-023 named MCP Apps rendered-host and clean-context Astro adoption evidence is complete. Native WebMCP remains unsupported until a suitable host is actually tested.
- [ ] The Astro/example dependency path to `http-cache-semantics@4.2.0` is assessed against [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) before an Astro support claim or provider launch.
- [ ] A final candidate tarball, digest/provenance, clean install, docs/example run and provider handoff are recorded on the exact release commit.

See [support limits](support-and-limitations.md), [compatibility](compatibility.md), [security model](../SECURITY.md), and [contributing](../CONTRIBUTING.md). A green repository CI run is one gate; it does not close the deployment and host gates.
