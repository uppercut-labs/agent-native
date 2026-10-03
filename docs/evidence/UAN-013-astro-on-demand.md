# UAN-013 Astro on-demand evidence draft

## Reproducible local checks

Run `npm run example:e02`. The exporter builds and packs the current package, copies the E02
after-state plus immutable before-state assets into `.exported`, generates `package-lock.json`,
installs with `npm ci`, runs tests, builds Astro, and starts the Node standalone production server.

The live check requests `/`, `/albums/`, and `/about/`; verifies that anonymous HTTP OpenAPI and
MCP tool discovery expose the same public capability metadata; invokes the authenticated Agent Native
HTTP route; connects with the official MCP 2.3.0 client and invokes the same sample capability; checks
that anonymous invocation is denied and invalid input is rejected through both transports; and proves
a protocol-shaped POST to the static negative file produces only its inert content. Build inspection
requires all three unrelated human pages under `dist/client` while the protocol routes stay on demand.

## Authentication and discovery boundary

The sample album capability is intentionally marked `access: public`. Its description, input/output
schemas, HTTP OpenAPI operation, and MCP tool listing are therefore public metadata. For this local
fixture only, the shared execution-context resolver requires `Bearer e02-local-fixture`; both HTTP
and MCP reject anonymous invocation. This tests invocation authorization parity without claiming
protected discovery or production identity. The bearer value is public fixture data.

Root checks are `npm run build`, `npm run build:test-fixtures`, `node --test test/init.test.mjs`, and
`npm run check`. Init coverage detects the committed on-demand fixture and official adapter, then
uses a disposable project to diagnose a missing adapter and reject `public/mcp.json` as a static
protocol impostor.

In the latest focused rerun after documenting the public-metadata/authenticated-invocation
boundary, `npm run format:check`, `npm run typecheck`, and `npm run example:e02` all passed. The E02
standalone command built, installed its fresh fixture dependencies, and passed its HTTP/OpenAPI/MCP
smoke assertions. The earlier draft run also had 11 focused init tests pass. The full
`npm run check` attempt reached the root socket tests, where the sandbox began rejecting every new
loopback listener with `listen EPERM: operation not permitted 127.0.0.1`; a direct retry had the
same environmental failure. Earlier in the same run, the root 73-test suite and E02 live server had
both completed successfully before that restriction appeared.

## Precise limits

This is local evidence for Astro 7.3.5, `@astrojs/node` 11.1.6 standalone mode, Node 22.12 or newer,
and the official MCP client/server packages at 2.3.0. It does not prove another Astro release,
adapter, provider, TLS termination, external host, commercial MCP client, production identity,
rate limiting, or deployment. The checked bearer value is public fixture data. The Astro
integration does not install an adapter or generate endpoints. Existing-project init detects these
conditions but deliberately leaves complex/on-demand config changes to reviewed application code.
The standalone install reported four high-severity transitive audit findings; no unsafe automatic
or breaking dependency rewrite was applied, so dependency review remains a release gate.
