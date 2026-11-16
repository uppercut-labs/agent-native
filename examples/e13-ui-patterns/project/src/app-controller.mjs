// DOM-free view controller: joins the official MCP Apps `App`, a UiStore and the built-in patterns.
// The React view (src/view.mjs) renders the store; tests drive this module with AppBridge.
import { canonicalCapabilityId, capabilitySurfaceNames } from '@uppercut-labs/agent-native';
import { UiStore } from '@uppercut-labs/agent-native/ui';
import {
  createMcpActionPort,
  receiveToolResult,
  selectionContext,
} from '@uppercut-labs/agent-native/ui/mcp';
import {
  mediaAnnotation,
  parameterExplorer,
  reviewQueue,
  validAnnotationInput,
  validReviewInput,
} from '@uppercut-labs/agent-native/ui/patterns';
import { identities } from './identities.mjs';

const { annotationsSave, exploreOpen, mediaOpen, reviewOpen, reviewSave } = Object.fromEntries(
  Object.entries(identities).map(([key, identity]) => [key, { identity }]),
);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const update = (surfaceId, path, value) => ({
  version: '1.0',
  updateDataModel: { surfaceId, path, value },
});
const toolName = (capability) => capabilitySurfaceNames(capability.identity).mcp;

const PATTERNS = {
  review: {
    open: reviewOpen,
    accepts: (r) => isRecord(r) && Array.isArray(r.records) && typeof r.canSave === 'boolean',
    project(store, result) {
      if (store.snapshot('review') === undefined)
        return [reviewQueue(result.records, 'saveReview', 'review')];
      const records = Object.fromEntries(
        result.records.map((r) => [r.id, { title: r.title, before: r.before, draft: r.draft }]),
      );
      return [update('review', '/records', records)];
    },
  },
  explore: {
    open: exploreOpen,
    accepts: (r) => isRecord(r) && typeof r.attempts === 'number' && typeof r.rate === 'number',
    project(store, result) {
      const messages =
        store.snapshot('explore') === undefined ? [parameterExplorer('explore')] : [];
      return [
        ...messages,
        update('explore', '/attempts', result.attempts),
        update('explore', '/rate', result.rate),
      ];
    },
  },
  media: {
    open: mediaOpen,
    accepts: (r) => isRecord(r) && typeof r.duration === 'number' && Array.isArray(r.lines),
    project(store, result) {
      const messages =
        store.snapshot('media') === undefined
          ? [
              mediaAnnotation(
                {
                  kind: 'audio',
                  source: 'fixture-tone',
                  duration: result.duration,
                  lines: result.lines,
                },
                'saveAnnotations',
                'media',
              ),
            ]
          : [];
      return [...messages, update('media', '/annotations', result.annotations)];
    },
  },
};

function decodeWrite(result, onSuccess) {
  if (!isRecord(result)) return { kind: 'uncertain', message: 'The host returned no result.' };
  if (result.isError === true) {
    const text = Array.isArray(result.content)
      ? result.content.find((item) => isRecord(item) && item.type === 'text')?.text
      : undefined;
    return { kind: 'denied', message: typeof text === 'string' ? text : 'The save was refused.' };
  }
  const value = isRecord(result.structuredContent) ? result.structuredContent.result : undefined;
  if (!isRecord(value)) return { kind: 'uncertain', message: 'The save result could not be read.' };
  return { kind: 'success', value, messages: onSuccess(value) };
}

/**
 * @param {{ app: import('@modelcontextprotocol/ext-apps').App, pattern: 'review'|'explore'|'media',
 *   requestId?: () => string, onChange?: () => void }} options
 */
export function createUiAppController({
  app,
  pattern,
  requestId = () => crypto.randomUUID(),
  onChange = () => {},
}) {
  const spec = PATTERNS[pattern];
  if (spec === undefined) throw new TypeError(`Unknown pattern ${pattern}.`);
  const surfaceId = pattern;
  let store;
  let canSave = false;
  let status = { kind: 'waiting', message: 'Waiting for the host to send data.' };

  const port = createMcpActionPort(app, [
    {
      capabilityId: canonicalCapabilityId(reviewSave.identity),
      toolName: toolName(reviewSave),
      risk: 'write',
      arguments: (request) => ({
        requestId: request.requestId,
        drafts: request.action.context.selected.map((id) => ({
          id,
          draft: request.action.context.records[id].draft,
        })),
      }),
      decode: (result) =>
        decodeWrite(result, (value) =>
          value.saved.map((id) =>
            update('review', `/records/${id}/before`, store.read('review', `/records/${id}/draft`)),
          ),
        ),
    },
    {
      capabilityId: canonicalCapabilityId(annotationsSave.identity),
      toolName: toolName(annotationsSave),
      risk: 'write',
      arguments: (request) => ({
        requestId: request.requestId,
        annotations: request.action.context.annotations,
      }),
      decode: (result) => decodeWrite(result, () => []),
    },
  ]);

  function ensureStore() {
    if (store !== undefined) return store;
    const actions = !canSave
      ? []
      : pattern === 'review'
        ? [
            {
              name: 'saveReview',
              capabilityId: canonicalCapabilityId(reviewSave.identity),
              risk: 'write',
              validate: validReviewInput,
            },
          ]
        : pattern === 'media'
          ? [
              {
                name: 'saveAnnotations',
                capabilityId: canonicalCapabilityId(annotationsSave.identity),
                risk: 'write',
                validate: validAnnotationInput,
              },
            ]
          : [];
    store = new UiStore({ actions, requestId, actionPort: port });
    store.subscribe(onChange);
    return store;
  }

  function receive(result) {
    if (isRecord(result) && result.isError === true) {
      status = { kind: 'error', message: 'The host reported that this tool call failed.' };
      onChange();
      return [status.message];
    }
    const canonical = isRecord(result?.structuredContent)
      ? result.structuredContent.result
      : undefined;
    if (store === undefined && isRecord(canonical) && typeof canonical.canSave === 'boolean')
      canSave = canonical.canSave;
    const target = ensureStore();
    const errors = receiveToolResult(target, result, (value) => {
      if (!spec.accepts(value)) throw new TypeError('Unexpected result shape.');
      return spec.project(target, value);
    });
    status =
      errors.length === 0
        ? { kind: 'ready', message: '' }
        : { kind: 'error', message: `This view could not use the result: ${errors[0]}` };
    onChange();
    return errors;
  }

  app.ontoolinput = () => {
    if (store?.snapshot(surfaceId) === undefined) {
      status = { kind: 'loading', message: 'Loading…' };
      onChange();
    }
  };
  app.ontoolresult = (params) => receive(params);
  app.ontoolcancelled = () => {
    status = { kind: 'error', message: 'The host cancelled this tool call.' };
    onChange();
  };

  return {
    surfaceId,
    get store() {
      return store;
    },
    get status() {
      return status;
    },
    get canSave() {
      return canSave;
    },
    receive,
    /** Host-mediated follow-up read: refetch through the host, keeping local drafts. */
    async refresh() {
      try {
        const result = await app.callServerTool({ name: toolName(spec.open), arguments: {} });
        return receive(result);
      } catch {
        status = { kind: 'error', message: 'The host could not refresh this view.' };
        onChange();
        return [status.message];
      }
    },
    /** Shares only the explicitly allowed paths with the model; never the full data model. */
    async shareSelection(paths) {
      if (store?.snapshot(surfaceId) === undefined) return false;
      const context = selectionContext(store, surfaceId, paths);
      await app.updateModelContext({
        content: [{ type: 'text', text: JSON.stringify(context) }],
        structuredContent: context,
      });
      return true;
    },
  };
}
