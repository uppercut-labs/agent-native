# E01 Astro static album catalog

This example starts from the tracked pre-integration Astro project at
`examples/e01-album-catalog/site-before`: home, albums, and about pages, shared navigation, CSS,
SVG mark, and public album data. The standalone fixture retains those pages/assets/navigation and
adds the Agent Native browser capability to its existing albums page.

Astro is pinned to 7.3.5 with a committed lockfile. The supported package integration uses Astro's
`astro:config:setup` `injectScript('page', ...)` hook and confirms `buildOutput === 'static'`.
It requires static output and does not install an Astro server adapter. The browser bootstrap uses
`astro:page-load`, `astro:before-swap`, and Window `pageshow` to handle initial load, client
navigation, and back-forward cache restoration.

The public album data in `src/data/albums.mjs` feeds both the pre-rendered page and the capability's
shared browser-safe registry in `src/catalog-shared.mjs`. Server HTTP code remains in
`src/catalog.mjs` and is not imported into the browser entry.

From the package repository root, run `npm run example:e01`. This builds and checks the before-state
site, packs and installs the package into an exported standalone project, runs simulated lifecycle
and Astro hook tests, and builds/checks the final static output. The WebMCP API is simulated in tests;
the repository's test/uan023-native-webmcp.mjs probe also runs the built albums page in Chrome 155
with its opt-in WebMCP feature, including client navigation. No browser agent was used. Unsupported WebMCP keeps the ordinary HTML album lookup
available with an explanatory status message.
