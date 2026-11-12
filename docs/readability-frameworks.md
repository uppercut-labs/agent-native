# Framework examples for site publication

Each project pairs the same Harbor field guide with a distinct application. Start from the matching project, follow the framework's production build and inspect how its public data supplies the human page and its Markdown mirror. The field guide's original edition departs from Pier Four. The updated edition moves the departure to Pier Seven and withdraws a route.

| Integration | Production behavior exercised | Showcase |
| --- | --- | --- |
| Astro | Content collection, static HTML and a Node-rendered advisory. A second config builds a file-only version. | Breakwater field guide and tide advisory |
| Next.js | App Router static parameter enumeration with server route handlers for protected resources | Field recording course |
| React with Vite | Vite production pages, client routing, deep links and playback queue | Night Ferry track |
| Vue with Vite | Vue Router with generated canonical pages and query-based catalog filters | Brass coupler parts catalog |
| SvelteKit | Server load, dynamic event route, protected attendee route and adapter-node | Lantern workshop |
| Nuxt | Nuxt file routing, server-rendered locale-specific pages and Nitro's Node preset | Bilingual museum exhibit |
| React Router framework mode | Nested framework route modules, server loader, redirect and error response | River line transit stops |
| Angular | Parameterized prerendering, hydration and lazy checklist | Atlas equipment handbook |

The route and field allowlists are part of each example. Change those to match the adopting application and review them with its access rules. The examples use the shared experimental publication API and the framework integration code in their source. Version pins and lockfiles specify the tested framework and toolchain. Hosted compatibility and results from independent language models require separate evidence.

[Runnable source and native test instructions](https://github.com/uppercut-labs/agent-native/blob/feat/site-publication-v1-1/examples/readability/README.md) · [Publication and adoption guide](site-publication.md)
