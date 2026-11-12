# Release status — November 11, 2026

This is a dated source-versus-distribution note. Check the npm registry, current branch manifest, and [PR #10](https://github.com/uppercut-labs/agent-native/pull/10) for subsequent changes.

| Surface | Verified status on this date |
| --- | --- |
| [npm package](https://www.npmjs.com/package/@uppercut-labs/agent-native) | `@uppercut-labs/agent-native@1.1.0` is published. |
| Default GitHub `main` | `package.json` still declares `1.0.1`. Its code and development checks describe that source tree. |
| [1.1.0 source PR](https://github.com/uppercut-labs/agent-native/pull/10) | `feat/site-publication-v1-1` declares `1.1.0`, adds experimental `/publication` and `agent-native-site`, and contains eight framework publication examples. The PR remains open; the source has not been merged into `main`. |
| GitHub `v1.1.0` tag | Not present when checked. Do not advertise a 1.1.0 GitHub release archive or infer that npm publication merged the source. |

## Which instructions to use

- **Install the published package:** `npm install @uppercut-labs/agent-native@1.1.0`. Use the [1.1.0 installation guide](https://github.com/uppercut-labs/agent-native/blob/feat/site-publication-v1-1/docs/installation.md), [experimental site-publication guide](https://github.com/uppercut-labs/agent-native/blob/feat/site-publication-v1-1/docs/site-publication.md), and [framework examples](https://github.com/uppercut-labs/agent-native/blob/feat/site-publication-v1-1/docs/readability-frameworks.md).
- **Build the default GitHub checkout:** use `npm ci` and `npm run check` on `main`. It still builds 1.0.1; the site-publication executable and 1.1.0 framework examples are not present.
- **Review 1.1.0 source:** check out `feat/site-publication-v1-1`, then use its manifest and tests. Keep source-branch behavior distinct from a clean registry install.

Eleven capability entry points remain stable under the existing 1.x compatibility policy. The publication API and **separate** `agent-native-site` executable are experimental. That command is not `agent-native init`, a general-purpose site converter, or a hosting service. These source and local-fixture checks do not certify arbitrary hosted applications, agent clients, or production access-control policies.

After PR #10 merges, review this dated note, the default-branch version references and GitHub release guidance together. Do not merely change `main`'s package version to 1.1.0 without the corresponding implementation and release checks.
