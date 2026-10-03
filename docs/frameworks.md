# Framework support

This table records framework surfaces actually built and checked in this package. It is not a
compatibility promise for every release in a listed major version.

| Framework | Supported shape | Verified environment | Boundary |
| --- | --- | --- | --- |
| Astro | Static browser bootstrap through `agentNativeAstro({ browserEntry })` | Astro 7.3.5, Node 22.12+ fixture | Requires `output: 'static'`; no server adapter or SSR endpoint |

The Astro integration uses the documented `astro:config:setup` page-script injection hook and
`astro:config:done` output diagnostic. The E01 fixture preserves existing static pages and
navigation. Its official build output is checked for static pages/assets and for absence of HTTP and
MCP server adapter code in browser bundles.

The browser capability host remains experimental. E01 exercises a simulated WebMCP API in Node
tests, not a real browser or agent. Other Astro releases, server output, deployment providers, and
real-host WebMCP behavior are unverified.

Astro references: [integration hooks](https://docs.astro.build/en/reference/integrations-reference/)
and [ClientRouter lifecycle](https://docs.astro.build/en/guides/view-transitions/).
