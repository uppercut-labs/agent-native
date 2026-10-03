# UAN-021 documentation coverage evidence

This documentation audit used an isolated clone on `research` at public base
`79f7e4ea8324ed616d83c04715a1eaf4dd175144`, Node.js 24.18.0 and
`npm ci --ignore-scripts --no-audit --no-fund`. The clone has no canonical
Git remote write. The package remains private at `0.0.0`.

## Checked result

- Every E01-E12 coverage record now carries requirement IDs and a guide with a
  source-backed region from that example's tested project source. The docs
  coverage validator rejects missing paths, stale negative probes, missing
  source regions, omitted example scripts, and missing CI wiring.
- The generated reference lists the 18 current typed package subpaths and
  runner flags and typed adapter configuration directly from `package.json` and checked source. A parser
  option or guarded bound change requires a reference update.
- Public guides now give a Node prerequisite, root export command, expected
  fixture result, relevant failure and repair, and source or example link.
  Compatibility and support statements were reconciled with the existing
  E01-E12 fixtures. They do not claim production or universal host support.
- `node --test docs-site/coverage-check.test.mjs docs-site/source-regions.test.mjs docs-site/reference.test.mjs`
  passed 8 of 8 focused tests. `npm run docs:check` built 36 HTML
  pages including the home page, verified 35 search entries, and validated
  twelve example coverage records. `node --check` passed for ten
  source files with new marker comments; scoped Biome format/lint passed.

The docs command validates wiring and generated pages. This audit did not
rerun all twelve exported projects; that is the root `npm run check` gate
on Node 22/24 CI. It did not test deployed docs, physical browsers, native
WebMCP, a commercial MCP Apps host, or an npm installation.
