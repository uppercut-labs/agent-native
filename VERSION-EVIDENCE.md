# UAN-001 version evidence

Checked 2026-10-02 against the package registries and official project documentation. These
versions are pinned exactly in `package.json` and `package-lock.json`; this baseline does not
claim protocol or host support.

| Component | Version | Role | Primary source |
| --- | --- | --- | --- |
| Node.js | 24.18.0 (local verification runtime) | Local build/test runtime; package engine floor is Node 22 | [Node.js release downloads](https://nodejs.org/en/download) |
| npm | 12.1.0 (local package manager) | Lockfile and scripts | [npm CLI documentation](https://docs.npmjs.com/cli/) |
| TypeScript | 7.0.2 | Strict compiler and declaration build | [TypeScript download](https://www.typescriptlang.org/download/), [npm package](https://www.npmjs.com/package/typescript) |
| Zod | 4.6.5 | Runtime validation and native JSON Schema export | [Zod JSON Schema guide](https://zod.dev/json-schema), [npm package](https://www.npmjs.com/package/zod) |
| Ajv | 8.20.0 | Independent validation of exported draft-2020-12 JSON Schemas in tests | [Ajv JSON Schema guide](https://ajv.js.org/json-schema.html), [npm package](https://www.npmjs.com/package/ajv) |
| Biome | 2.5.15 | Independent formatter and linter | [Biome formatter](https://biomejs.dev/formatter/), [npm package](https://www.npmjs.com/package/@biomejs/biome) |

Zod's native JSON Schema conversion was selected for the spike because the official guide
documents `z.toJSONSchema()`. The adapter requests `unrepresentable: 'throw'`, and the test
suite includes a transform that must fail projection rather than silently change meaning.
Ajv's draft-2020-12 implementation validates the exported schemas independently from Zod.

The scaffold has not selected the SDK, framework adapters, test coverage needed for release,
or public support matrix. MIT is the selected license. Recheck versions and upstream APIs before
each implementation ticket that depends on them.
