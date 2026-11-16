// Type-level proof that an application using React 19 can drive the UI renderer with React's
// own createElement, createRoot and server renderer: no casts, no wrapper types.
// Checked by `tsc -p tsconfig.ui-react.json` as part of `npm run check:ui`.
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { UiStore } from '../src/ui.js';
import { parameterExplorer } from '../src/ui-patterns.js';
import {
  createReactRenderer,
  mediaElementId,
  type ReactRenderer,
  type RendererOptions,
} from '../src/ui-react.js';
import { uiStyles } from '../src/ui-styles.js';

/** Mounts one surface into a container and re-renders on store changes. Returns a disposer. */
export function mountReactSurface(
  container: HTMLElement,
  store: UiStore,
  surfaceId: string,
  options: RendererOptions<ReactElement> = {},
): () => void {
  const root: Root = createRoot(container);
  let disposed = false;
  const renderer: ReactRenderer<ReactElement> = createReactRenderer(createElement, {
    ...options,
    onViewChange: render,
    seekMedia(id: string, componentId: string, seconds: number): void {
      const media: HTMLElement | null = document.getElementById(mediaElementId(id, componentId));
      if (
        media instanceof HTMLMediaElement &&
        container.contains(media) &&
        Number.isFinite(media.duration)
      )
        media.currentTime = Math.max(0, Math.min(media.duration, seconds));
    },
  });
  function render(): void {
    if (!disposed)
      root.render(
        createElement(
          'div',
          null,
          createElement('style', null, uiStyles),
          renderer.render(store, surfaceId),
        ),
      );
  }
  const unsubscribe: () => void = store.subscribe(render);
  render();
  return (): void => {
    disposed = true;
    unsubscribe();
    renderer.dispose();
    root.unmount();
  };
}

/** Server-renders a surface to HTML with React 19. */
export function renderSurfaceToString(store: UiStore, surfaceId: string): string {
  const renderer: ReactRenderer<ReactElement> = createReactRenderer(createElement);
  try {
    return renderToString(renderer.render(store, surfaceId));
  } finally {
    renderer.dispose();
  }
}

const store: UiStore = new UiStore();
store.apply(parameterExplorer());
export const html: string = renderSurfaceToString(store, 'explore');
