# UAN-007 Astro static integration evidence

## Fixture and before-state

The tracked pre-integration site at `examples/e01-album-catalog/site-before` is an Astro 7.3.5
static project with home, albums, and about pages; shared site layout and navigation; public album
data; CSS; and SVG mark. `baseline-manifest.json` contains SHA-256 hashes for its project config,
pages, data, and assets. The E01 check rebuilds that fixture before packaging and confirms the
integrated project retained byte-identical layout, home/about pages, data, CSS, and SVG. The album
page adds the human search form and browser capability bootstrap.

## Verification

Run `npm run example:e01` from the package root. It builds the baseline static project from a
temporary copy, builds/packs the package, installs the package into the standalone fixture, executes
the example tests, then builds and verifies the integrated static output. The checks cover:

- Static `index.html`, `albums/index.html`, and `about/index.html`, preserved navigation,
  public album content, CSS, and SVG.
- Astro static output diagnostics and rejection of server output; no adapter is installed.
- Shared album lookup through local execution, the browser registry, and the page fixture.
- Astro ClientRouter page-load resync, before-swap revocation, repeat-install deduplication,
  unsupported-WebMCP human search, Window pagehide, and back-forward cache pageshow re-entry.
- Browser bundle exclusion checks for the HTTP and official MCP server adapters.

The WebMCP API and Astro lifecycle are simulated in Node tests. Astro's production static build is
real. No graphical browser, real WebMCP implementation, agent host, deployment provider, or
lilgohan.com site was tested or changed. This fixture makes no production-hosting assumption.

## Dependency audit limit

The fixture pins `astro@7.3.5`, which resolves `http-cache-semantics@4.2.0`. On 2026-10-02,
`npm audit` reports GHSA-ch52-4w7c-c8xp as high severity for that transitive package. The root
development tree reports two high findings (Astro and the transitive cache package); the standalone
Astro fixture reports three because Agent Native's optional Astro peer is also associated with the
same Astro finding. `npm audit --omit=dev` on the package root reports zero vulnerabilities, and
the package tarball does not bundle Astro. However, Astro consumers install Astro as their own
dependency and may encounter the affected transitive package.

The registry has no patched `http-cache-semantics` release above 4.2.0 at this check; npm's
suggested Astro 2.10.9 downgrade is a breaking major rollback and was not applied. No override was
added without a patched version to target. Release remains gated on resolving the upstream advisory
or an explicit risk decision.
