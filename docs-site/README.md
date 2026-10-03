# Public docs site shell

The site is generated from `docs/**/*.md` and remains static after build. It needs no account or runtime service. Run from the repository root:

```sh
npm ci
npm run docs:check
```

Serve `docs-site/dist/` with any static file server. Search reads the generated local JSON index. Each rendered page links to raw Markdown and its GitHub source. `docs:check` builds the site, rejects missing local Markdown targets/headings, and verifies generated navigation, assets, and search entries. Links into `examples/` open the source file on GitHub. External URLs are not fetched or validated.

Use `{{source:examples/<example>/project/<file>#<region>}}` on its own line in a guide to render a region from a runnable example. The source file must contain exactly one `// docs:start <region>` and `// docs:end <region>` pair. `docs:check` fails for invalid paths, missing or duplicate markers, and empty regions. It embeds the code in both HTML and generated raw Markdown, with a link to the exact source line. Source files must remain within their example's `project/` directory.

This remains a UAN-021 slice. It does not export all twelve examples or certify host support. Those acceptance steps remain in the parent ticket.

`coverage.json` maps E01-E12 to a root export script, runnable project source, public guide, evidence note, instructions, and a negative test probe. `docs:check` rejects missing or stale paths, absent probes, script mismatches, and examples omitted from the root `check` command. That root command is the Node 22/24 CI export gate. The manifest checks coverage wiring; it does not run examples or claim external host support.
