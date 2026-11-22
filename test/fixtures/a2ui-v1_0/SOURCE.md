# A2UI v1.0 JSON schemas (vendored test fixtures)

Copied unmodified from [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui) at commit
`57f961f143da23f4212313e432a64b5843d978f9` (2026-11-16), path `specification/v1_0/json/`.
Licensed under the Apache License 2.0; see `LICENSE` in this folder.

| File | SHA-256 |
| --- | --- |
| `agent_to_renderer.json` | `2f575f783fdda0e4d175fe5d331661655e4a4901613262322792dae7e823761d` |
| `catalog_definition.json` | `836a48b2deb7ae76c3b68cb4e79c2faa24cba36d4d5396474894796797364d44` |
| `common_types.json` | `c4e78305be1de73eecb37f8179ba169730250611703683af291b18135a6430dc` |
| `renderer_to_agent.json` | `58ecde02101f0f37566b5e238dc6ef6af628c3ff312fce0e17ab7670b7215465` |
| `LICENSE` | `8c8b5b632d56c4c1658296963c693db5396772a33caaddb9a22593c4155c437a` |

`test/ui-a2ui-schema.test.mjs` checks these hashes before using the schemas. To move to a newer
upstream commit, replace the files, update this table and rerun `npm run check:ui`.
