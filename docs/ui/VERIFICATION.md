# Verification

## Integrated into the package source — November 16, 2026

Integrated on branch `agent-native-ui` from `feat/site-publication-v1-1` at `a605fde` (package 1.1.0), on macOS with Node.js 26.10.0, the repository's TypeScript 7.0.2 and Biome 2.5.15.

| Check | Observed result | Boundary |
|---|---|---|
| Repository build, typecheck and Biome lint/format | Passed after rewriting 291 index-signature property reads to bracket form and applying Biome's fixes | No behavior change |
| `check:ui` | 55 tests passed: 48 candidate tests and 7 A2UI conformance tests; portable import graph clean | |
| Official A2UI v1.0 schemas | Catalog validates as a catalog definition; every built-in pattern message plus update and delete messages validate against `agent_to_renderer.json` | Schemas from a2ui-project/a2ui `57f961f`, vendored with hashes in `test/fixtures/a2ui-v1_0` |
| Negative conformance | Unknown component, unknown property, missing required property, out-of-catalog enum, reserved `Surface`, unregistered function, wrong version and two operations per message are rejected by both the official schema and `UiStore` | The unregistered-function case was accepted by `UiStore` before this integration and is now rejected at validation |
| Full `npm run check` | See the branch's latest commit message for the recorded run | Includes E09 MCP Apps regression |

Still pending: React 18/19 type and runtime validation, an official ext-apps App/AppBridge exchange driving the UI, real ChatGPT web and Claude web runs, physical-device checks and publication.

## Candidate workspace — November 16, 2026

## Observed results

| Check | Observed result | Boundary |
|---|---|---|
| Candidate strict TypeScript build | Passed | TypeScript 5.8.3; not source repository's 7.0.2 toolchain |
| Automated Node tests | 52 passed, zero failures | Candidate protocol/state/actions/bridge descriptors and integration-tool tests |
| Portable core compilation | Passed without DOM or Node typings | Isolated candidate core, patterns, presentation and structural bridge |
| Import graph/static checks | Eight portable modules, no external imports/renderer imports | Static checks; not a production secret scan of the full repository |
| DOM preview browser suite | 20 passed observations | Chromium 144.0.7559.96, inline document, no external browser navigation |
| Real React browser suite | 20 passed observations | React/ReactDOM 16.0.0 in Chromium; legacy runtime only, not recommended for production |
| Layout | 375/768/1280px checked, no page-width overflow; 200% CSS zoom | Emulation, not physical-phone or browser-zoom certification |
| Keyboard | Tabs, form controls and visible focus exercised | Not a complete WCAG audit or screen-reader test |
| Audio/video | Owned synthetic audio; generated one-second 60fps video; explicit playback, seek, range/annotation bounds, removal | Standalone browser evidence only; not chat-host media/CSP proof |
| Offline artifact | Full generated HTML executed with inline import map in browser | Opening file:// and localhost URLs blocked by browser administrator policy; neither navigation claimed passed |
| Local HTTP server | Native Node/Python loopback response, MIME/method/missing-file checks | Not browser navigation or public deployment |
| Additive integration tool | Dry run, base check, apply, idempotence, conflict refusal tested in temporary local Git fixtures | Not applied to real source repository |

Detailed actual output is in `evidence/node-tests.log`, `evidence/browser-tests.json`, `evidence/react-tests.json`, `evidence/server-tests.json`, and screenshot directories. Candidate test fixtures are synthetic. Neither an SDK mock nor a screenshot is counted as commercial-host acceptance.

## Browser behavior covered

Empty state; stable field focus; selected save; denied save retaining input; overlapping incoming update preserving local edits; explicit conflict recovery; local slider/calculation/chart; audio metadata/no autoplay; seek/annotation creation; annotation save; transcript editing; narrow viewports; 200% CSS zoom; keyboard focus; standalone HTML execution; numeric/checkbox/select/radio/keyboard-tab/selectable-list behavior; disabled unregistered actions/literal code-like text; synthetic video playback/clamping/removal; no uncaught JavaScript errors.

Additional controls testing found and fixed the DOM preview's option-value attribute handling. Media remount now restores the remembered bounded playhead instead of silently resetting it. Compiler checking caught an impossible boolean branch after disabling full-model metadata. All affected suites were rerun.

## Explicitly unperformed

No full official A2UI schema validation/catalog publication or official-renderer interoperability; no complete A2UI 1.0 implementation; no current React 18/19 installed type/runtime check; no official ext-apps runtime exchange; no upstream E09/whole-repository check, Biome gate, npm install/lockfile resolution, API export policy or full package consumer proof; no real ChatGPT/Claude host, authenticated tool call, physical iPhone/Android, real customer data, cross-conversation persistence, production idempotency, npm publication or deployment.

The GitHub connector available in this session exposed read operations but no write operations. Container GitHub/npm access also could not resolve external hosts. Therefore there is no new remote branch, commit, PR or private ledger update to verify. The archive and local integration patch are the delivered result.
