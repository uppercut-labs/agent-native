# Public docs site shell

The site is generated from `docs/**/*.md` and remains static after build. It needs no account or runtime service. Run from the repository root:

```sh
npm ci
npm run docs:check
```

Serve `docs-site/dist/` with any static file server. Search reads the generated local JSON index. Each rendered page links to raw Markdown and its GitHub source. `docs:check` builds the site, rejects missing local Markdown targets/headings, and verifies generated navigation, assets, and search entries. Links into `examples/` open the source file on GitHub. External URLs are not fetched or validated.

This is an independent UAN-021 infrastructure slice. It does not replace code sketches with extracted tested source regions, export all twelve examples, or certify host support. Those acceptance steps remain in the parent ticket.
