# Angular equipment desk

This Angular Router application shares the Harbor field guide and adds parameterized operator handbooks. Open `/equipment/atlas-7` for the Atlas 7 settings and a lazy pre-use checklist. The Atlas 9 page uses a different torque value. The Angular application builder enumerates reviewed model slugs at build time through `getPrerenderParams`, renders each canonical route as static HTML, then hydrates the browser application. A service-only record remains outside the public projection.

Run from this directory with Node 24 and the lockfile. The shared build adapter can use a packed SDK installed into this fixture or the built SDK in the repository. Set `SITE_URL` to the canonical deployment origin before building. The default is `http://127.0.0.1:4173`.

```sh
npm ci
npm run build
npm start
```

The HTML, Markdown and discovery files are in `dist/browser`. Serve those files with exact routes or directory indexes. The included local server returns 403 for private routes and 404 for unrecognized resources. Configure equivalent access controls and missing-route responses on the chosen host.

The verification command starts its own local server. Stop any instance already listening on the selected port, install a compatible Chromium browser and exercise the production build.

```sh
npx playwright install chromium
npm run verify
```

Set `CHROMIUM_EXECUTABLE` to use a preinstalled Chromium. The verifier checks cold HTML and Markdown retrieval, applicable structured data, missing and protected URLs, private marker absence, browser hydration, lazy chunk retrieval, checklist completion and Angular Router navigation. For withdrawal testing, build with `READABILITY_EDITION=original`, serve and capture the original fact and retired guide, then rebuild with `READABILITY_EDITION=updated` and compare the live route, mirror and aggregate. Hosted qualification requires the actual deployment's origin and independent evidence.
