# Existing Astro site: experimental init

The `@uppercut-labs/agent-native/init` entrypoint is available in the
`0.1.3` preview package. There is no `agent-native init` executable yet. Use the E01 fixture to try the current
programmatic flow from a local package tarball:

```sh
npm ci
npm run example:e01
```

E01 copies an existing static Astro site into a temporary directory, installs a
local tarball, applies a reviewed plan, and builds the site. It checks the
original pages, routes, assets, data, and lockfile preservation after installation.

## Plan before applying

The supported automatic edit is intentionally narrow: an Astro project with a
single, literal `defineConfig({ output: 'static' })` configuration. Detection
reads project files as data; it does not import the site's config or business
modules. A project with multiple apps, competing lockfiles, dynamic config, or
an unsupported host receives an unresolved action instead of a guessed edit.

Detection also distinguishes pure static output from `prerender = false` on-demand routes. It
records whether the Astro config has a server adapter, diagnoses `server-adapter-missing`, and
rejects static files placed at known HTTP/MCP protocol paths. Existing on-demand projects are
manual-integration cases: init does not rewrite their adapter or endpoint routes. Select a sidecar
for a pure static site, or review same-origin endpoints and a supported adapter explicitly. Never
rewrite an Astro 7 project to the removed historical `output: 'hybrid'` mode.

After installing this source package into a disposable Astro project, a caller
can inspect the plan and then explicitly approve the same choices:

```js
import { applyInitPlan, createInitPlan, restoreInit } from '@uppercut-labs/agent-native/init';

const projectRoot = '/absolute/path/to/existing-astro-site';
const choices = {
  hosting: 'cloudflare',
  routeMode: 'sidecar',
  sidecarOrigin: 'https://your-worker.example',
};
const plan = await createInitPlan(projectRoot, {}, choices);
console.log(plan);

// Review detection, unresolved actions, proposed files, and choices first.
const result = await applyInitPlan(projectRoot, plan, choices, { approved: true });
console.log(result);

// Later, if the generated files are unchanged:
// await restoreInit(projectRoot);
```

The plan digest binds detected evidence, overrides, and selected choices.
Apply rechecks that evidence and refuses a stale plan. A second init is a
no-op. Restore checks ownership and content digests before changing any file;
it reports a conflict if a generated file was edited. Keep the ownership file
at `.agent-native/ownership.json` with the project until restoration is no
longer needed.

## What this slice creates

The installer patches the recognized Astro config to inject
`.agent-native/browser-entry.mjs` as a page script and writes
`.agent-native/init.json` with the selected mode and sidecar origin. The browser
entry emits an `agent-native:ready` event. It does not discover site functions,
register a capability, create a server route, deploy a Worker, or edit the
project's dependencies or lockfile. Bind only reviewed application operations
using the [capability guide](capabilities-and-bindings.md), and use the
[static-site guide](static-sites.md) for the separate Worker example.

E01's installed after-state explicitly executes its public album lookup through the shared
registry and authorization port. Init does not generate this application code:

<!-- source:examples/e01-album-catalog/project/src/catalog.mjs#local-album-execution -->
~~~js
/** @param {unknown} input */
export function runAlbumLookup(input) {
  return executeCapability(registry, {
    identity: getAlbumCapability.identity,
    runtime: 'local',
    input,
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  });
}
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e01-album-catalog/project/src/catalog.mjs#L36)
<!-- /source -->

The `npm run example:e01` export uses Node.js 22 or newer and a root `npm ci`. It builds the
static site and checks found/missing results. A malformed album slug is rejected before the
handler runs; correct the slug and retry. See the [E01 project instructions](https://github.com/uppercut-labs/agent-native/blob/main/examples/e01-album-catalog/project/README.md).

The current init API is a tested foundation for a later interactive CLI.
It is not a production deployment or a browser-agent host test.
