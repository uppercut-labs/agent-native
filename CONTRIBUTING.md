# Contributing

Agent Native is an unreleased preview. Discuss an intended API or documentation change in a GitHub issue before a broad refactor. Do not put credentials, private deployment details, or exploit reports in public issues; follow [SECURITY.md](SECURITY.md).

## Local setup

Use Node.js 22 or newer and npm from the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
```

Choose the smallest check that covers the changed surface. Examples install a fresh local tarball and run their own project checks, such as `npm run example:e05` for the Node/CLI surface or `npm run example:e04` for the Worker sidecar. `npm run docs:check` builds the public documentation and verifies local links and the example coverage manifest. CI runs `npm run check` on Node 22 and 24; use that broad gate for integration or release candidates instead of repeating it for each small edit.

## Change requirements

- Keep core exports free of provider, framework, Node-only, and browser-only imports. Declare adapter peers only where a consumer needs them.
- Require an explicit authorization port for execution. Test rejected input, denied access, and failed or uncertain completion as well as success.
- Update the affected guide, runnable example, and evidence note when behavior or a support claim changes. Record the command, environment, outcome, and limits. Fixture success is not a commercial host or production deployment claim.
- Preserve public/private boundaries. This repository contains distributable source; internal planning, credentials, grant data, generated archives, and local environment files do not belong in a pull request.
- Keep a proposed change scoped and reviewable. Include the checks actually run and call out unverified hosts or providers.

`npm pack --dry-run --json` runs `prepack` and should include every path named by `package.json.exports`. A packed example proves its own integration path; it does not replace a clean consumer or deployment check. The [release handoff](docs/release-handoff.md) records the remaining v1 gates.
