import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { preparePublication } from '../shared/publication.mjs';
import { candidates } from './source.mjs';

export function fieldGuideConfig(staticOnly = false) {
  return defineConfig({
    output: 'static',
    ...(staticOnly ? { outDir: './dist-static' } : { adapter: node({ mode: 'standalone' }) }),
    integrations: [
      {
        name: 'reviewed-collection-publication',
        hooks: {
          'astro:config:setup': async () => {
            await preparePublication({
              appDir: import.meta.dirname,
              showcase: candidates,
              approvedRoutes: ['/field-notes/breakwater', '/advisories/tide-window'],
            });
          },
          'astro:route:setup': ({ route }) => {
            if (staticOnly && route.component === 'src/pages/advisories/tide-window.astro')
              route.prerender = true;
          },
        },
      },
    ],
  });
}
export default fieldGuideConfig();
