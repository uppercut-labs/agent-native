# Integrating into Agent Native

## Source boundary

The intended source base is `uppercut-labs/agent-native`, branch `feat/site-publication-v1-1`, commit `a605fdebef2ff1705340f95a41b9a5a5b24346cc` (package 1.1.0). The inspected `main` still described 1.0.1. Do not overwrite main's package manifest or discard unrelated 1.1 work.

The candidate's root package is a **private validation wrapper**, not a proposed second npm product. It is never copied over the existing package. The additive integration tool installs source/tests/docs and merges only isolated exports and a named check script.

```sh
node /path/to/agent-native-ui/tools/integrate.mjs /path/to/agent-native
# Inspect the dry-run plan, then:
node /path/to/agent-native-ui/tools/integrate.mjs /path/to/agent-native --apply
```

The tool checks the package name and exact Git revision, refuses conflicting files/exports/scripts, checks bundle hashes, makes no commits, and never publishes/deploys. When the source base has moved, inspect the changes before using the explicit `--allow-newer-base` option. This override does not waive file-conflict protection. New files are rolled back and the old package bytes restored if a write fails.

`agent-native-ui.patch` is an **additions-only source patch** for the same file set. It does not replace package.json or add exports. The integration tool is the complete route; the patch is useful for code review. After applying only the patch, run the integration tool to merge manifest entries (identical pre-existing files are accepted).

## Proposed isolated entrypoints

`./ui`, `./ui/react`, `./ui/patterns`, `./ui/presentation`, `./ui/mcp`, `./ui/styles`, and optional `./ui/dom` preview. Root capability/executor exports do not import any of them. The portable modules import no React, DOM, Node or host SDK. React is supplied by the consuming application; no old React test runtime is added as a dependency.

The renderer takes React's `createElement` as an injected factory, so the package never imports React. [test/ui-react19-consumer.ts](https://github.com/uppercut-labs/agent-native/blob/main/test/ui-react19-consumer.ts) is a typed consumer-owned `createRoot` mount and subscription lifecycle; `check:ui` type-checks it against React 19 with no casts and server-renders every pattern. `node test/ui-react19-browser.mjs` (opt-in, needs Google Chrome and `playwright-core`) runs that same mount in Chrome.

## Preserve the canonical capability output

Agent Native's existing adapter already puts a capability's validated output under `structuredContent.result`. Do **not** double-wrap it using `presentationResult`.

For an existing capability whose output must not change, call `receiveToolResult(store, result, applicationProjector)`. The projector validates/reads the existing canonical output and returns A2UI messages for the view. The canonical output remains untouched, and text-only clients still receive the ordinary result.

For a newly declared capability whose output schema explicitly includes `{summary,data,a2ui}`, return `presentationValue(summary,data,messages)` as the capability's canonical value. `presentationResult` is a separate convenience for raw MCP servers that are not already wrapping canonical output.

## Reuse the current MCP Apps adapter

```ts
import { canonicalCapabilityId } from '@uppercut-labs/agent-native/contracts';
import { createMcpAppsHandler } from '@uppercut-labs/agent-native/mcp-apps';
import { PresentationRegistry } from '@uppercut-labs/agent-native/ui/presentation';

const presentations = new PresentationRegistry(
  registry.definitions.map(definition => canonicalCapabilityId(definition.identity)),
  [{
    capabilityId: 'example.catalog:lookup@1',
    catalogId: 'urn:uppercut:agent-native-ui:catalog:1',
    resourceUri: 'ui://catalog/review.html',
    name: 'Catalog review',
  }],
);
const handler = createMcpAppsHandler(registry, {
  ...existingMcpOptions,
  resources: presentations.resources(() => bundledViewHtml),
});
```

`registry`, `existingMcpOptions` and `bundledViewHtml` belong to the host application. The existing adapter still filters discovery, validates resources and calls the shared authorization/executor. Presentation registration grants no permissions. The UI's action port must map fixed capability IDs to fixed tools and decode authoritative outputs. Server input validation, ownership checks, grants and idempotency remain mandatory.

[E13](https://github.com/uppercut-labs/agent-native/blob/main/examples/e13-ui-patterns/project/README.md) is a complete view built on the **official** `App` bridge. `npm run example:e13` runs it against the official MCP SDK, and it rendered in ChatGPT web and Claude web ([evidence](../evidence/ANUI-004-ui-mcp-apps.md)). Normal controls remain local; sharing explicitly allowlisted context does not request a model turn.

## Resource/CSP and media

Bundle the React view, styles and official App SDK into a self-contained HTML resource through the application's normal bundler. Keep the existing adapter's closed CSP and resource limit. Do not use the offline playground's import map/data modules as proof that an MCP host permits them. That artifact is only the standalone workbench.

The renderer accepts application-owned media asset keys mapped to approved URLs. Model-provided URLs cannot expand that map. Actual host media access remains constrained by CSP and host permissions; standalone synthetic media success is not a ChatGPT/Claude media claim.

## Required integration gates

Run the source repository's own compiler, Biome formatting/lint, API/export policy, package portability checks, existing E09 regression and normal `npm run check`, plus the added `check:ui`. Reconcile experimental-export documentation and any API snapshots using the existing policy. `npm run check` runs `check:ui`. No official SDK exchange, real ChatGPT/Claude acceptance, physical phone test, or package publication is claimed.
