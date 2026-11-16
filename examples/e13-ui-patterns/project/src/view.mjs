// Browser view bundled into each MCP App resource. React renders the shared UiStore; every
// server call goes through the host's official App bridge, never a direct fetch.
import { App } from '@modelcontextprotocol/ext-apps';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { createReactRenderer, mediaElementId } from '@uppercut-labs/agent-native/ui/react';
import { uiStyles } from '@uppercut-labs/agent-native/ui/styles';
import { createUiAppController } from './app-controller.mjs';

// Owned synthetic audio generated in the page: a 12-second 220 Hz tone pattern.
function fixtureTone() {
  const rate = 8000;
  const count = rate * 12;
  const view = new DataView(new ArrayBuffer(44 + count * 2));
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) {
    const t = i / rate;
    const phase = t % 3;
    const sample =
      phase < 0.3 ? Math.sin(2 * Math.PI * 220 * t) * Math.sin((Math.PI * phase) / 0.3) * 3200 : 0;
    view.setInt16(44 + i * 2, Math.round(sample), true);
  }
  return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
}

const pattern = document.body.dataset.pattern;
const container = document.getElementById('root');
const root = createRoot(container);
const app = new App(
  { name: 'Agent Native UI fixture', version: '1.0.0' },
  {},
  { autoResize: true },
);
let shared = '';
const controller = createUiAppController({ app, pattern, onChange: () => render() });
const renderer = createReactRenderer(h, {
  mediaSources: pattern === 'media' ? { 'fixture-tone': fixtureTone() } : {},
  onViewChange: () => render(),
  seekMedia(surfaceId, componentId, seconds) {
    const media = document.getElementById(mediaElementId(surfaceId, componentId));
    if (media instanceof HTMLMediaElement && Number.isFinite(media.duration))
      media.currentTime = Math.max(0, Math.min(media.duration, seconds));
  },
});

function applyTheme(context) {
  if (context?.theme === 'dark' || context?.theme === 'light')
    document.documentElement.dataset.theme = context.theme;
}

function render() {
  const { store, status, canSave, surfaceId } = controller;
  const ready = store?.snapshot(surfaceId) !== undefined;
  root.render(
    h(
      'div',
      null,
      h('style', null, uiStyles),
      status.message ? h('p', { className: 'e13-status', role: 'status' }, status.message) : null,
      ready && pattern !== 'explore' && !canSave
        ? h(
            'p',
            { className: 'e13-note' },
            'Saving needs a signed-in account. Your edits stay in this view.',
          )
        : null,
      ready ? renderer.render(store, surfaceId) : null,
      ready
        ? h(
            'div',
            { className: 'e13-bar' },
            h(
              'button',
              { type: 'button', onClick: () => void controller.refresh() },
              'Refresh from server',
            ),
            pattern === 'review'
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: async () => {
                      try {
                        shared = (await controller.shareSelection(['/selected']))
                          ? 'Selected record IDs shared with the chat.'
                          : '';
                      } catch {
                        shared = 'This host did not accept shared context.';
                      }
                      render();
                    },
                  },
                  'Share selection with the chat',
                )
              : null,
            shared ? h('span', { role: 'status' }, shared) : null,
          )
        : null,
    ),
  );
}

app.onhostcontextchanged = (context) => applyTheme(context);
render();
app
  .connect()
  .then(() => applyTheme(app.getHostContext()))
  .catch(() => {
    container.textContent = 'This host does not support MCP Apps. Ask for the text result instead.';
  });
