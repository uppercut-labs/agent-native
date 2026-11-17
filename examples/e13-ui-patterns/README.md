# E13: Agent Native UI patterns in MCP Apps

Three capabilities open the built-in UI patterns as MCP App views: a review queue, a probability explorer and a media annotation view. Two protected capabilities save review drafts and annotations.

- Each open capability is registered with `PresentationRegistry` and served through the existing `createMcpAppsHandler`, so discovery, schemas, authorization and the executor are unchanged.
- The view renders with React 19 and talks to the server only through the host's official `App` bridge: follow-up reads with `callServerTool`, and explicitly allowed selections with `updateModelContext`.
- Saves are protected and idempotent per caller and `requestId`. A reused `requestId` with different input is refused. Anonymous hosts never see the save tools; the view disables saving and keeps edits.
- Hosts without MCP Apps support still receive the ordinary text and structured result.

See [project/README.md](project/README.md) to run it and [the UI integration guide](../../docs/ui/INTEGRATION.md).
