import {
  bootstrapApplication,
  BootstrapContext,
  provideClientHydration,
} from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  provideServerRendering,
  PrerenderFallback,
  RenderMode,
  ServerRoute,
  withRoutes,
} from '@angular/ssr';
import { App, routes } from './app';
import publication from '../generated/publication.json';

const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  ...['guides', 'equipment'].map(
    (prefix): ServerRoute => ({
      path: prefix + '/:slug',
      renderMode: RenderMode.Prerender,
      fallback: PrerenderFallback.None,
      getPrerenderParams: async () =>
        publication.pages
          .filter((p) => p.route.startsWith('/' + prefix + '/'))
          .map((p) => ({ slug: p.route.split('/')[2] })),
    }),
  ),
];

export default (context: BootstrapContext) =>
  bootstrapApplication(
    App,
    {
      providers: [
        provideRouter(routes),
        provideClientHydration(),
        provideServerRendering(withRoutes(serverRoutes)),
      ],
    },
    context,
  );
