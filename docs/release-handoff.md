# Release and provider handoff

This handoff covers the `0.1.1` preview candidate. The public source is [uppercut-labs/agent-native](https://github.com/uppercut-labs/agent-native); `@uppercut-labs/agent-native` is its npm name and MIT is its license. Check the registry before claiming publication. See [UAN-024 release evidence](evidence/UAN-024-release-readiness.md) for the earlier `0.0.0` preparation snapshot.

## Package release sequence

1. Select the preview version, remove the package's private flag, and align the changelog and installation guide.
2. Run the Node 22/24 CI matrix on the exact candidate commit. The example negative probes and independent tarball install are part of that gate.
3. From a clean checkout of that commit, run `npm ci` and `npm pack --json`. Inspect the actual tarball, license, README, documentation, dependency licenses, production audit, file list, and every declared export. Record its SHA-256 digest, package file count and size, source SHA, and Node/npm versions. Install the archive in a clean consumer and run the documented first capability.
4. Publish that exact archive under the organization scope with public access. Record the registry URL and digest. Keep the source tag and registry artifact tied to the same source commit.
5. Perform a post-publish clean registry install and the documented first-run path. If publication or provenance verification fails, report the actual registry state and recovery action; never describe a local tarball as a published npm release.

The provider gates below apply to application deployments and full host claims. The package has no `bin` entry; users call its programmatic APIs or application-owned CLI runner. Do not advertise `npx agent-native init` until an executable exists and is tested.

## Native provider deployment

Agent Native supplies contracts and adapters, not a managed hosting account. The deploying application owns its provider resources and operational policy:

| Surface | Application-owned deployment work | Minimum live evidence |
| --- | --- | --- |
| Static Astro plus Worker sidecar (E01/E04) | Choose the sidecar origin, provision the Worker and routes, configure allowed Host/Origin/CORS and revision matching, bind secrets outside source control, and keep the static site independent. | Public and denied routes, cross-origin denial, OpenAPI and MCP client roundtrip through the deployed address, rollback of Worker and routing. |
| Astro on-demand (E02) or Next App Router (E03) | Provide a supported server runtime, own endpoint mounting and framework adapter, deploy the site and server together, and verify static/prerendered pages remain correct. | HTTP and MCP calls, auth/denial, framework build, navigation and rollback at the real deployment. |
| Node/Hono or another server (E05) | Own the process, TLS/front proxy, route path, limits, logs, credentials and restart behavior. | Local and remote CLI parity through the deployed endpoint, malformed input, auth denial and health evidence. |
| Browser and MCP Apps (E06/E09) | Choose an actual host with the needed API, obtain host consent, set resource CSP/sandbox policy, and keep server credentials out of browser assets. | Named host version and origin, visible tool registration and action, denied call, iframe/CSP behavior, cleanup after navigation. |

For protected capabilities, the application must provide token verification, issuer/audience/scope policy, resource authorization, a durable grant store, revocation consistency, idempotency for mutations, and incident response. A timeout can leave a write's completion uncertain; do not retry it blindly. The local E07 grant fixture and E11 doctor profile are examples, not production identity or persistence services. Record provider account owner, deployment ID, route/DNS owner, secret storage location (never the secret), rollback command, log/trace location, and the person who accepts live behavior in the deployment runbook.

## Open provider and full-host acceptance gates

- [x] GitHub private vulnerability reporting is enabled for the public repository; the [Security Advisories page](https://github.com/uppercut-labs/agent-native/security/advisories) is the private report channel.
- [ ] Finish UAN-020 security/failure-safety review and document its production support limits.
- [ ] UAN-021 guides and every E01-E12 example have checked prerequisites, expected output, a negative path, and source-backed evidence.
- [ ] UAN-022 Windows and Linux representative install/CLI behavior, dependency license inventory, and overhead measurements have a recorded decision.
- [ ] UAN-023 named MCP Apps rendered-host and clean-context Astro adoption evidence is complete. Native WebMCP remains unsupported until a suitable host is actually tested.
- [ ] The Astro/example dependency path to `http-cache-semantics@4.2.0` is assessed against [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) before an Astro support claim or provider launch.
- [ ] A final candidate tarball, digest/provenance, clean install, docs/example run and provider handoff are recorded on the exact release commit.

See [support limits](support-and-limitations.md), [compatibility](compatibility.md), [security model](https://github.com/uppercut-labs/agent-native/blob/main/SECURITY.md), and [contributing](https://github.com/uppercut-labs/agent-native/blob/main/CONTRIBUTING.md). A green repository CI run is one gate; it does not close the deployment and host gates.
