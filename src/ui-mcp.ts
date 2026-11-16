import type { ActionOutcome, ActionPort, ActionRequest, Json, JsonObject } from './ui/types.js';
import { byteLength, jsonObject, readAt } from './ui/json.js';
import type { UiStore } from './ui/store.js';
import { presentationValue } from './ui-presentation.js';
import type { PresentationValue } from './ui-presentation.js';
/** Structural adapter for the official ext-apps App; no replacement postMessage protocol. */
export interface McpAppBridge {
  callServerTool(request: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }): Promise<unknown>;
}
export type McpActionMapping = {
  readonly capabilityId: string;
  readonly toolName: string;
  readonly risk: 'read' | 'write' | 'destructive';
  readonly arguments: (request: ActionRequest) => JsonObject;
  readonly decode: (result: unknown) => ActionOutcome;
};
export function createMcpActionPort(
  bridge: McpAppBridge,
  mappings: readonly McpActionMapping[],
): ActionPort {
  let index: Map<string, McpActionMapping> = new Map();
  for (const mapping of mappings) {
    if (!mapping.capabilityId || !mapping.toolName || index.has(mapping.capabilityId))
      throw new TypeError('Invalid or duplicate MCP mapping.');
    index.set(mapping.capabilityId, Object.freeze({ ...mapping }));
  }
  return {
    async execute(request: ActionRequest): Promise<ActionOutcome> {
      const mapping: McpActionMapping | undefined = index.get(request.capabilityId);
      if (mapping === undefined)
        return { kind: 'denied', message: 'Capability is not exposed by this app.' };
      const args: JsonObject = mapping.arguments(request);
      if (!jsonObject(args) || byteLength(JSON.stringify(args)) > 32768)
        return { kind: 'denied', message: 'Invalid or oversized tool arguments.' };
      try {
        const result: unknown = await bridge.callServerTool({
          name: mapping.toolName,
          arguments: args,
        });
        return mapping.decode(result);
      } catch {
        return mapping.risk === 'read'
          ? { kind: 'error', message: 'Host tool call failed.' }
          : {
              kind: 'uncertain',
              message: 'Host tool call ended without a confirmed write result.',
            };
      }
    },
  };
}
export type PresentationResult = PresentationValue;
/** Raw MCP servers only; Agent Native already wraps its canonical output. */
export function presentationResult(
  summary: string,
  data: Json,
  a2ui: readonly JsonObject[],
): {
  readonly content: readonly {
    readonly type: 'text';
    readonly text: string;
  }[];
  readonly structuredContent: {
    readonly result: PresentationResult;
  };
} {
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: { result: presentationValue(summary, data, a2ui) },
  };
}
/** App.ontoolresult handler helper. Invalid messages never become executable HTML. */
export function receiveToolResult(
  store: UiStore,
  result: unknown,
  project?: (canonicalResult: Json) => readonly JsonObject[],
): readonly string[] {
  if (!jsonObject(result)) return ['Invalid host result.'];
  const structured: Json | undefined = result['structuredContent'];
  if (!jsonObject(structured) || structured['result'] === undefined)
    return ['No canonical structured result; use the text fallback.'];
  let messages: readonly Json[];
  if (project !== undefined) {
    try {
      messages = project(structured['result']);
    } catch {
      return ['Application output projection failed validation.'];
    }
    if (!Array.isArray(messages)) return ['Application output projection did not return messages.'];
  } else {
    if (!jsonObject(structured['result']) || !Array.isArray(structured['result']['a2ui']))
      return ['No A2UI presentation in this result; use the text/structured fallback.'];
    messages = structured['result']['a2ui'];
  }
  if (messages.length > 64) return ['Too many presentation messages.'];
  let errors: string[] = [];
  for (const message of messages) {
    const applied = store.apply(message);
    if (applied.kind === 'rejected') errors.push(applied.issue.message);
    else if (applied.response !== undefined)
      errors.push('A function response needs an application-owned return channel.');
  }
  return errors;
}
/** Only selected, developer-approved paths become model-visible context. */
export function selectionContext(
  store: UiStore,
  id: string,
  allowedPaths: readonly string[],
): JsonObject {
  const data: JsonObject = store.data(id);
  let selection: Record<string, Json> = {};
  for (const path of allowedPaths) {
    const value: Json | undefined = readAt(data, path);
    if (value !== undefined) selection[path] = value;
  }
  const result: JsonObject = { surfaceId: id, selection };
  if (byteLength(JSON.stringify(result)) > 8192)
    throw new TypeError('Model context selection exceeds the limit.');
  return result;
}
