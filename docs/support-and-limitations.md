# Support and limitations

Agent Native is an **unreleased preview** at version `0.0.0`; the package manifest is private. The current site documents source behavior and local fixtures, not an npm installation or production deployment.

## Fixture-tested surfaces

The repository contains local examples for static Astro (E01), Astro on-demand (E02), Next App Router (E03), a Worker sidecar (E04), Node/Hono with CLI (E05), browser-only fallback (E06), protected grants (E07), reusable composition (E08), MCP Apps (E09), and shared unit conversion (E12). Open each guide's source links and evidence notes for the pinned environment and exact scope. A fixture result applies to the commit and tools used for that run; it does not imply universal compatibility.

The local MCP checks use official SDK client/server packages. The browser draft checks use a simulated WebMCP API. E09 exercises the official MCP Apps protocol components locally, but a commercial host's iframe behavior and prompts remain unverified.

## Still open before release

- E10 and E11 after-state integrations, exact generated references, all twelve independently exported examples, and source-backed snippets are later ticket work. Their before-state fixtures are already checked in.
- Provider deployment, real commercial MCP Apps hosts, native browser agents, physical devices, and outsider installation are not yet certified.
- OAuth issuance, durable production grant storage, application record policy, deployment ownership, and hosting remain application responsibilities.
- The package is not published to npm. No installation command in these docs claims that it is.

See [framework support](frameworks.md), [fixture compatibility](compatibility.md), and the individual [adapter surfaces](surfaces.md) for narrower statements. Report documentation problems through the repository's [GitHub issues](https://github.com/uppercut-labs/agent-native/issues); this link uses the actual public repository issue route.
