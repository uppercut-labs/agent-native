# Agent Native UI generation instructions

Use ordinary text unless direct manipulation materially helps. Prefer a registered pattern for review, parameters, or media; compose lower-level components only when the task needs it. This library makes no model calls and is not an agent framework.

The runtime accepts a **bounded A2UI 1.0 profile** and a custom catalog, not Google's entire Basic Catalog. Read `catalog-discovery.json` and `PROTOCOL.md`. The discovery document lists registration metadata; it is **not** an upstream-compliant JSON Schema catalog. Application runtime validation is authoritative.

## Message example

```json
{
  "version": "1.0",
  "createSurface": {
    "surfaceId": "review_summary",
    "catalogId": "urn:uppercut:agent-native-ui:catalog:1",
    "components": [
      {"id":"root","component":"Column","children":["heading","field"]},
      {"id":"heading","component":"Text","text":"Review title","variant":"heading"},
      {"id":"field","component":"TextField","label":"Title","value":{"@path":"/title"}}
    ],
    "dataModel": {"title":"Draft title"}
  }
}
```

One message has one operation. Use stable Unicode identifier-style component IDs (`record_name`, not `record-name`). `root` is the rendered root. Catalog IDs are application identifiers, never remote code URLs. Components use flat properties; bindings use `{"@path":"/title"}`. The surface's component graph may arrive progressively. Missing children display placeholders; cycles are rejected.

To change data, emit `updateDataModel`. `/` or an omitted path replaces the root object; `null` deletes the addressed value. Do not resend `createSurface` for an existing surface. To alter components, emit `updateComponents` containing complete replacements for those IDs. An array of events is applied in order, not as a cross-message transaction.

## Actions and privacy

Only developer-registered actions can execute. Use `{"action":{"event":{"name":"registeredName","context":{"selection":{"@path":"/selected"}}}}}` on an action component. Never provide executable scripts, arbitrary tool names, credentials, network origins, or storage instructions. An action name does not grant access: the existing server executor authorizes every call.

Do not request `sendDataModel:true`; this profile deliberately rejects automatic full-model transmission. The application may explicitly share allowlisted paths. Do not erase unfinished edits to make an updated server value appear saved. Conflicts require a direct user choice. An uncertain write stays uncertain until authoritative reconciliation; do not retry automatically.

Registered local functions can calculate values without a model call. Only the registered pure functions may appear in `@call` bindings. There is no arbitrary formula evaluator. Media uses application-provided asset keys, not agent-supplied URLs. Do not start playback automatically. Empty/error/denied states are part of every usable interface, not reasons to invent records.
