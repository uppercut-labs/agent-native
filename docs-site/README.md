# Public docs site shell

The site is generated from `docs/**/*.md` and remains static after build. It needs no account or runtime service. Run from the repository root:

```sh
npm ci
npm run docs:check
```

Serve `docs-site/dist/` with any static file server. Search reads the generated local JSON index. Each rendered page links to raw Markdown and its GitHub source. `docs:check` runs focused coverage, source-region and reference tests, builds the site, rejects missing local Markdown targets/headings, and verifies generated navigation, assets, and search entries. Links into `examples/` open the source file on GitHub. External URLs are not fetched or validated.

Use `{{source:examples/<example>/project/<file>#<region>}}` on its own line in a guide to render a region from a runnable example. The source file must contain exactly one `// docs:start <region>` and `// docs:end <region>` pair. `docs:check` fails for invalid paths, missing or duplicate markers, and empty regions. It embeds the code in both HTML and generated raw Markdown, with a link to the exact source line. Source files must remain within their example's `project/` directory.

All twelve example exports are wired into the root check and Node 22/24 CI. Each mapped guide renders a marked region from its tested example source. The docs build itself validates the paths and snippets; it does not execute the examples or certify an external host.

`coverage.json` maps E01-E12 to a root export script, runnable project source, public guide with a source-backed snippet, evidence note, requirement IDs, instructions, and a negative test probe. `docs:check` rejects missing or stale paths, absent probes, script mismatches, and examples omitted from the root `check` command. That root command is the Node 22/24 CI export gate. The manifest checks coverage wiring; it does not run examples or claim external host support.

The [API and CLI reference](../docs/reference.md) is generated from the package export map, CLI parser, and exported adapter option declarations with `node docs-site/reference.mjs`. The docs check compares the rendered source to current implementation and fails on drift.
