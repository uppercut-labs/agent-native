# UAN-018 surface override and schema evidence

## Scope

A definition may explicitly choose an HTTP path/method and a CLI command/aliases. GET is restricted to read capabilities with a representable top-level query schema. The HTTP handler, generated OpenAPI operation, local CLI, and remote CLI use that definition. Defaults retain the canonical POST route and canonical CLI identity. This is a local implementation slice, not a production host certification.

E10 exports the unchanged existing `searchContent({ query, limit })` function and data from `service-before` into a fresh consumer. Its new binding preserves `GET /api/content/search?q=night&limit=1`, exposes `content-search` and `search`, and leaves unrelated health and content routes available. The before-state source files were not edited.

## Reproduction and observed results

On canonical `research` (Darwin arm64, Node 25.9.0, npm 11.12.1) after integrating the isolated Node 24 worker:

```sh
npm run typecheck
npm run build
node --test test/composition.test.mjs test/http.test.mjs test/cli.test.mjs test/zod.test.mjs
npm run example:e10
npm run example:e12
npm run docs:check
npm run format:check
npm run lint
```

All commands exited successfully. The focused root suite passed 36/36, fresh E10 installed from a package tarball and passed 4/4 plus a CLI smoke call, E12 passed 6/6, and the docs checker validated 27 HTML pages and 26 search entries. The E10 and E12 exported installs each reported zero audit vulnerabilities. The isolated worker had already passed Node 24 typecheck/build/format/lint, 24 focused tests, and fresh E10 4/4. A full local repository suite was not repeated; Node 22/24 CI is the integration gate.

Negative tests cover GET on a write capability, duplicate HTTP routes and CLI aliases, unsupported or malformed query conversions, missing/invalid input, bounded GET query bytes, non-finite JSON numbers, unsupported Zod transforms, invalid output, and a JSON `__proto__` field without prototype mutation. Remote CLI calls follow the overridden GET route and query mapping. Same-ID surface changes now fail the UAN-017 compatibility guard; a description-only change remains compatible.

## Limits

The GET projection supports documented scalar and flat-array query fields; nested objects and unsupported conversions fail rather than being coerced. The example uses a local Node host and synthetic public data. It does not validate an external API gateway, deployed identity, browser agent, or npm registry installation. The public package remains `private: true` at `0.0.0`.
