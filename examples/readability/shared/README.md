# Run the publication fixtures

Use Node 24. From the repository root, run `npm ci` and `npm run build`. Then change into one example directory, run `npm ci`, and use the following commands. Set the same origin during the build and when serving it.

```sh
SITE_URL=http://127.0.0.1:4173 npm run build
HOST=127.0.0.1 PORT=4173 npm start
```

Open `/guides/getting-started` for the reference experience and `/llms.txt` for discovery. Each app generates its public HTML and Markdown from the same approved fields. Review changes to the showcase's explicit `approvedRoutes` list before building. Unknown routes and private content cannot enter the public projection just because their data exists. Each fixture's `generated/` directory contains build-private inputs and the CLI ownership journal. Only the framework deployment directories belong on a public host.

| Example | Showcase route | Native behavior and update boundary |
| --- | --- | --- |
| Astro | `/field-notes/breakwater` | The file-backed content collection builds a field note. Follow its advisory link to the Node-rendered, uncached tide page. Its reviewed content updates at rebuild. `npm run build:static` instead prerenders the advisory along with the reference pages into `dist-static/` for a static host. |
| Next.js | `/courses/field-recording` | App Router prerenders the reviewed dynamic course slugs and generates route metadata. The studio lab link reaches an application-owned Node route that requires the configured bearer token. Course content updates at rebuild. |
| React with Vite | `/tracks/night-ferry` | Read the track credit on a cold GET, then add the track to the queue and follow the field-guide link with React Router. The Vite build also emits a static entry for every reviewed deep link. |
| Vue with Vite | `/parts/brass-coupler` | Read the dimensions and pressure rating, open the parts catalog, and filter by name. Vue Router holds the filter in the query string. Each reviewed part keeps one canonical and one mirror. |

Rebuild with `READABILITY_EDITION=original` to reproduce the earlier Meridian departure and retired connector. Then run the default build in the same directory to observe the revised departure, withdrawn connector and unchanged Harbor departure. The Vite production servers use file-first routing and return 404 for an absent mirror. Configure equivalent lookup rules on a static host.

To exercise a package archive, install it in the individual example directory after `npm ci` and before building with `npm install --no-save --package-lock=false /absolute/path/to/candidate.tgz`. The helper uses the installed package's exported planner and CLI. Its source-checkout fallback requires the SDK to have been built in the repository root.
