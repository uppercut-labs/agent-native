// Browser host for test/ui-react19-browser.mjs. Mounts the built-in patterns with React 19
// through the same mountReactSurface that test/ui-react19-consumer.ts type-checks.
import { UiStore } from '../../src/ui.js';
import type { ActionOutcome, ActionRequest, JsonObject } from '../../src/ui.js';
import {
  mediaAnnotation,
  parameterExplorer,
  reviewQueue,
  validAnnotationInput,
  validReviewInput,
} from '../../src/ui-patterns.js';
import { mountReactSurface } from '../ui-react19-consumer.js';

// Owned synthetic fixture generated in the page: a 12-second 220 Hz tone pattern.
function fixtureAudio(): string {
  const sampleRate = 8000;
  const count = sampleRate * 12;
  const view = new DataView(new ArrayBuffer(44 + count * 2));
  const ascii = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) {
    const t = i / sampleRate;
    const phase = t % 3;
    const sample =
      phase < 0.3 ? Math.sin(2 * Math.PI * 220 * t) * Math.sin((Math.PI * phase) / 0.3) * 3200 : 0;
    view.setInt16(44 + i * 2, Math.round(sample), true);
  }
  return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
}

const update = (surfaceId: string, path: string, value: unknown): JsonObject =>
  ({ version: '1.0', updateDataModel: { surfaceId, path, value } }) as JsonObject;
const trace: { capabilityId: string; requestId: string }[] = [];
let deny = false;
const store = new UiStore({
  actions: [
    {
      name: 'saveReview',
      capabilityId: 'ui.fixture:review.save@1',
      risk: 'write',
      validate: validReviewInput,
    },
    {
      name: 'saveAnnotations',
      capabilityId: 'ui.fixture:annotation.save@1',
      risk: 'write',
      validate: validAnnotationInput,
    },
  ],
  requestId: () => `fixture_${crypto.randomUUID()}`,
  actionPort: {
    async execute(request: ActionRequest): Promise<ActionOutcome> {
      trace.push({ capabilityId: request.capabilityId, requestId: request.requestId });
      if (deny) return { kind: 'denied', message: 'Fixture policy denied this save.' };
      const context = request.action.context as JsonObject;
      const messages: JsonObject[] = [];
      if (request.action.name === 'saveReview') {
        const records = context['records'] as Record<string, { draft: string }>;
        for (const id of context['selected'] as string[]) {
          messages.push(update(request.surfaceId, `/records/${id}/before`, records[id]?.draft));
        }
      } else messages.push(update(request.surfaceId, '/annotations', context['annotations']));
      return { kind: 'success', value: { saved: true }, messages };
    },
  },
});

const fixtures: Record<string, () => JsonObject> = {
  review: () =>
    reviewQueue([
      {
        id: 'alpha',
        title: 'Landing page review',
        category: 'Website',
        before: 'Review the landing page.',
        draft: 'Review the landing page and flag unclear next steps.',
      },
      {
        id: 'beta',
        title: 'Documentation follow-up',
        category: 'Documentation',
        before: 'Check the setup guide.',
        draft: 'Check the setup guide against a clean installation.',
      },
    ]),
  explore: () => parameterExplorer(),
  media: () =>
    mediaAnnotation({
      kind: 'audio',
      source: 'fixture-tone',
      duration: 12,
      lines: [
        { id: 'first', start: 0, text: 'Opening tone' },
        { id: 'second', start: 3, text: 'Second tone' },
      ],
    }),
};

const mediaSources = { 'fixture-tone': fixtureAudio() };
const container = document.getElementById('surface') as HTMLElement;
let unmount: (() => void) | undefined;
function load(name: string): void {
  if (!store.snapshot(name)) {
    const result = store.apply(fixtures[name]?.());
    if (result.kind === 'rejected') throw new Error(result.issue.message);
  }
  unmount?.();
  unmount = mountReactSurface(container, store, name, { mediaSources });
}

Object.assign(globalThis, {
  anui: { store, trace, load, update, setDeny: (value: boolean) => (deny = value) },
});
