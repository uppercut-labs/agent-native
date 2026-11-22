import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { preparePublication } from '../shared/publication.mjs';
import { pageOutputs } from '../shared/html.mjs';
import { part } from './catalog.mjs';

export default defineConfig(async () => {
  const model = await preparePublication({
    appDir: process.cwd(),
    showcase: part,
    approvedRoutes: ['/parts/brass-coupler'],
  });
  return { plugins: [vue(), pageOutputs(model)] };
});
