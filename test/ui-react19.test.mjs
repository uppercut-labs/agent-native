// Renders every built-in pattern with React 19 (the pinned react and react-dom dev
// dependencies) and fails on any React warning. Run after `npm run build`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, version } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { UiStore, UI_CATALOG_ID } from '../dist/ui.js';
import { mediaAnnotation, parameterExplorer, reviewQueue } from '../dist/ui-patterns.js';
import { createReactRenderer } from '../dist/ui-react.js';

const records = [
  { id: 'alpha', title: 'Landing page review', category: 'copy', before: 'Hi', draft: 'Hello' },
  { id: 'beta', title: 'Pricing note', category: 'copy', before: 'Old', draft: 'New' },
];
const surfaces = {
  review: reviewQueue(records),
  empty_review: reviewQueue([], 'saveReview', 'empty_review'),
  explore: parameterExplorer(),
  media: mediaAnnotation({
    kind: 'audio',
    source: 'fixture-audio',
    duration: 12,
    lines: [{ id: 'l1', start: 0, text: 'First line' }],
  }),
  video: mediaAnnotation(
    { kind: 'video', source: 'fixture-video', duration: 1, lines: [] },
    'saveAnnotations',
    'video',
  ),
};

function storeWith(...ids) {
  const store = new UiStore({
    actions: [
      {
        name: 'saveReview',
        capabilityId: 'example.review:save@1',
        risk: 'write',
        validate: () => true,
      },
      {
        name: 'saveAnnotations',
        capabilityId: 'example.media:annotate@1',
        risk: 'write',
        validate: () => true,
      },
    ],
    requestId: () => crypto.randomUUID(),
  });
  for (const id of ids) assert.equal(store.apply(surfaces[id]).kind, 'applied', id);
  return store;
}

/** Captures React's development warnings, which it reports through console.error. */
function withoutReactWarnings(fn) {
  const warnings = [];
  const original = console.error;
  console.error = (...args) => warnings.push(args.map(String).join(' '));
  try {
    return fn();
  } finally {
    console.error = original;
    assert.deepEqual(warnings, [], 'React reported warnings');
  }
}

function render(store, surfaceId, options) {
  const renderer = createReactRenderer(createElement, options);
  try {
    return withoutReactWarnings(() => renderToString(renderer.render(store, surfaceId)));
  } finally {
    renderer.dispose();
  }
}

test('the pinned runtime is React 19', () => {
  assert.match(version, /^19\./);
});

test('Review Queue renders records, edit fields, diffs and a save button', () => {
  const html = render(storeWith('review'), 'review');
  assert.match(html, /aria-label="Agent Native UI"/);
  assert.match(html, /Review queue/);
  assert.match(html, /aria-label="Select Landing page review"/);
  assert.match(html, /<textarea[^>]*>Hello<\/textarea>/);
  assert.match(html, /Save selected/);
  assert.equal((html.match(/data-component="Diff"/g) ?? []).length, 2);
});

test('an empty Review Queue shows its empty text instead of rows', () => {
  const html = render(storeWith('empty_review'), 'empty_review');
  assert.match(html, /No records to review\./);
  assert.doesNotMatch(html, /aria-label="Select /);
});

test('Parameter Explorer renders sliders and the locally calculated result', () => {
  const html = render(storeWith('explore'), 'explore');
  assert.equal((html.match(/type="range"/g) ?? []).length, 2);
  // 1 - (1 - 0.07)^3 = 19.56%, computed by the registered renderer function.
  assert.match(html, /19\.56/);
  assert.doesNotMatch(html, /placeholder=""/);
  assert.match(html, /width:7%/);
  assert.match(html, /Chance by attempt count/);
});

test('Media Annotation renders audio and video players without autoplay', () => {
  const store = storeWith('media', 'video');
  const mediaSources = { 'fixture-audio': '/media/a.wav', 'fixture-video': '/media/v.mp4' };
  const audio = render(store, 'media', { mediaSources });
  const video = render(store, 'video', { mediaSources });
  assert.match(audio, /<audio[^>]*src="\/media\/a\.wav"/);
  assert.match(video, /<video[^>]*src="\/media\/v\.mp4"/);
  for (const html of [audio, video]) assert.doesNotMatch(html, /autoplay/i);
  assert.match(audio, /First line/);
});

test('a media key the application did not register produces no source URL', () => {
  const html = render(storeWith('media'), 'media', { mediaSources: {} });
  assert.doesNotMatch(html, /src="/);
});

test('registered base64 audio data URLs are accepted; other data URLs are refused', () => {
  const store = storeWith('media');
  const ok = render(store, 'media', {
    mediaSources: { 'fixture-audio': 'data:audio/wav;base64,UklGRg==' },
  });
  assert.match(ok, /<audio[^>]*src="data:audio\/wav;base64,UklGRg=="/);
  const refused = render(store, 'media', {
    mediaSources: { 'fixture-audio': 'data:text/html;base64,PGI+aGk8L2I+' },
  });
  assert.doesNotMatch(refused, /src="data:/);
  assert.match(refused, /No registered media source is available\./);
});

test('an unregistered action renders its button disabled', () => {
  const store = new UiStore();
  store.apply({
    version: '1.0',
    createSurface: {
      surfaceId: 's',
      catalogId: UI_CATALOG_ID,
      components: [
        { id: 'root', component: 'Button', label: 'Go', action: { event: { name: 'nothing' } } },
      ],
      dataModel: {},
    },
  });
  assert.match(render(store, 's'), /<button[^>]*disabled=""/);
});

test('agent-supplied text is escaped, never rendered as markup', () => {
  const store = new UiStore();
  store.apply({
    version: '1.0',
    createSurface: {
      surfaceId: 's',
      catalogId: UI_CATALOG_ID,
      components: [{ id: 'root', component: 'Text', text: '<img src=x onerror=alert(1)>' }],
      dataModel: {},
    },
  });
  const html = withoutReactWarnings(() => {
    const renderer = createReactRenderer(createElement);
    return renderToStaticMarkup(renderer.render(store, 's'));
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
