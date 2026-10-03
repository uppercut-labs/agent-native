# UAN-009 existing-project init evidence

The programmatic `@uppercut-labs/agent-native/init` entrypoint was implemented in
[`638d79f`](https://github.com/uppercut-labs/agent-native/commit/638d79f76c40a94ed728010e689db69b86e21ae4)
and its cross-version fixture check was corrected in
[`19e108f`](https://github.com/uppercut-labs/agent-native/commit/19e108f3e4fcd8fffade0295a964d1cc99f78d02).
Builds and fixture runs used `research` over SSH, with Node 25.9.0 and npm
11.12.1. [GitHub CI run 37092885820](https://github.com/uppercut-labs/agent-native/actions/runs/37092885820)
passed the package check and pack dry run on Node 22 and 24.

## Verified behavior

- `npm run check` passed format, lint, typecheck, browser bundle proof, 59 root
  tests (including nine init tests), and the E01/E12/E05/E06/E04 example checks.
- `npm run example:e01` copied an existing Astro static site into a path with
  spaces, installed a fresh local tarball, applied an approved plan, and built
  three static pages. The emitted browser JavaScript included the init ready
  event and selected sidecar origin. Existing page data, navigation, CSS, SVG,
  and non-server output remained intact. The fixture snapshots the lockfile
  after tarball installation and confirms init leaves it byte-identical.
- Init tests cover ambiguous app roots, competing lockfiles, dynamic config,
  unsupported hosting, an existing `/mcp` route, path and symlink refusal,
  stale plans, interruption before and after the Astro config write, rerun
  no-op, manifest tampering, and conflict-aware restoration.
- `npm pack --dry-run --json` included `dist/init.js` in a 73-file package.
  The package remains `private: true` at version `0.0.0`.

## Boundaries

Automatic config rewriting supports only the exact literal Astro static
template tested by E01. The exported flow is a JavaScript API, not a package
`init` executable. It records a selected sidecar origin and injects a browser
entry that signals readiness; it does not infer or register business
capabilities, install dependencies, create `/mcp`, deploy a Worker, or verify
an actual browser-agent host. E10 and E11 full standalone examples remain
future slices; this ticket tests their init failure cases with disposable
fixtures.

File checks guard normal edits and interruptions, but a concurrent external
writer can still change a target in the instant between its final hash check
and rename or removal. Pause other writers while applying or restoring. Astro
fixture installation still reports high severity transitive advisories;
dependency review remains a public release gate. No npm publication occurred.
