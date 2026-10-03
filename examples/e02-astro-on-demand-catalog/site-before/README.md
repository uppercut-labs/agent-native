# E02 pre-integration site

This directory is a complete Astro site before any Agent Native integration. It has a traditional
human-facing album catalog, an unrelated prerendered about page, and one ordinary Astro JSON route
that performs an album lookup on demand. It contains no Agent Native package, authentication,
remote MCP implementation, or MCP compatibility claim.

## Requirements and commands

Use Node.js 22.12.0 or newer, then run:

```sh
npm ci
npm run build
npm test
```

`npm test` inspects the build, starts the standalone server on an available loopback port, visits
the human pages, invokes the JSON lookup route, and reproduces the inert response to a protocol-shaped
POST sent to the static negative-case file. Run `npm start` after a build to keep the site running
locally.

## Pinned platform evidence

- `astro@7.3.5` is pinned exactly. Its npm metadata declares Node.js `>=22.12.0`.
- `@astrojs/node@11.1.6` is pinned exactly. It is maintained in the official Astro repository and
  its published peer dependency is `astro@^7.2.1`, which includes Astro 7.3.5.
- Astro's official Node adapter guide documents standalone mode for on-demand routes and the
  generated `dist/server/entry.mjs` entry point used here.

Registry evidence can be repeated with:

```sh
npm view astro@7.3.5 version engines repository --json
npm view @astrojs/node@11.1.6 version peerDependencies repository --json
```

Official sources: [Astro Node adapter guide](https://docs.astro.build/en/guides/integrations-guide/node/)
and [the adapter package in the Astro repository](https://github.com/withastro/astro/tree/main/packages/integrations/node).

## Boundaries

`public/protocol-post-negative.json` is deliberately just a static explanatory file. The standalone
adapter serves the same inert bytes for GET and POST with HTTP 200, but the test proves the POST does
not produce a JSON-RPC envelope, echo the request ID, or return a protocol result or error. It must
not be described or deployed as an MCP server. The fixture uses only public sample records and is
intended for local baseline verification, not production hosting.
