# Protocol profile and interoperability boundary

This is an implementation candidate for the A2UI 1.0 envelope using a custom application catalog. It is **not full A2UI conformance**. Official schema validation and official-renderer interoperability remain pending.

| Feature | Candidate behavior |
|---|---|
| `version: "1.0"` | Required; other versions rejected |
| `createSurface` | Explicit registered `catalogId`; optional initial components/object data; duplicate live IDs rejected |
| `updateComponents` | Full component replacement by ID; flat adjacency references; progressive missing-reference placeholders; cycles rejected |
| `updateDataModel` | Required value; root `/` or omitted path; `null` deletes; bounded JSON Pointer traversal |
| `deleteSurface` | Deletes state; stale async completion cannot mutate a recreated surface |
| `callRendererFunction` | Registered synchronous pure functions; caller restriction; required catalog; correlated response |
| `@path` and `@call` | Supported in the documented catalog fields and action contexts |
| Multiple registered catalogs | Explicit per-component `@catalogId`; custom trusted component renderer required |
| JSONL | Incremental framing, UTF-8 byte limits, CRLF/EOF, explicit terminal errors |
| User actions | Application `ActionPort`, mapped to fixed capability identity; not a new A2UI transport |
| Model context | Explicit developer allowlist through `selectionContext` |

Not implemented: `callAgentFunction`/`agentFunctionResponse` lifecycle; asynchronous renderer RPC; list templates and relative template contexts; `@index`; general validation expressions/`@checks`; all Basic Catalog components; surface metadata extensions; full dynamic-boolean coercion semantics; automatic `sendDataModel` metadata. These are unsupported, not compatibility claims. In particular `sendDataModel:true` is explicitly rejected rather than silently leaking or dropping data.

## Custom catalog

The default catalog contains 25 component names. Its properties belong to this catalog; familiar names do not imply compatibility with the upstream Basic Catalog's properties. For example this catalog's `Button` uses `label`, not the Basic Catalog's child-component contract. The application must advertise and validate this catalog specifically.

`CatalogRegistry.describe()` returns JSON-safe discovery metadata without callbacks or private state. It does not substitute for a formally published, upstream-schema-compliant catalog. `docs/catalog-discovery.json` is generated from the registered components.

## Safety and resource bounds

Default limits: eight surfaces, 512 components per surface, depth 32, 256 KiB message/model bounds. Root model must be an object. Prototype-reserved keys, unsupported component fields, unregistered functions, invalid paths, cycles and oversized values are rejected. Callback implementations and custom renderers are trusted application code, not agent output.

Drafts are overlaid on authoritative data and explicitly marked conflicted when their base changes. Save responses acknowledge only the exact sent draft echoed by authoritative data; newer edits survive. Duplicate in-flight actions are suppressed. This is not durable exactly-once execution, a database transaction, or production crash recovery. The server owns authorization, idempotency and persistence.

## Upstream reference baseline

Read on November 16, 2026:
- `a2ui-project/a2ui/specification/v1_0/docs/a2ui_protocol.md` (blob `91d8f3e0e2918e4131e8c622100d23605c580617`).
- `modelcontextprotocol/ext-apps/src/app.ts` and official quickstart: register result handlers before `App.connect`; use `App.callServerTool`, not direct token-bearing iframe fetches.
- Existing Agent Native `src/mcp-apps.ts`, pinned source `a605fdebef2ff1705340f95a41b9a5a5b24346cc`: official SDK helpers, registered `ui://` resources, closed CSP and existing shared executor.

Reference inspection is not runtime interoperability evidence. See `VERIFICATION.md`.
