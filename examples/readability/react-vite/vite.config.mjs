import { defineConfig } from 'vite';
import { preparePublication } from '../shared/publication.mjs';
import { pageOutputs } from '../shared/html.mjs';
import { track } from './catalog.mjs';

export default defineConfig(async () => {
  const model = await preparePublication({
    appDir: process.cwd(),
    showcase: track,
    approvedRoutes: ['/tracks/night-ferry'],
  });
  return { plugins: [pageOutputs(model)] };
});
