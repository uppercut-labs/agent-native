import { fileURLToPath } from 'node:url';
import { preparePublication } from '../shared/publication.mjs';
import { exhibits } from './exhibits.mjs';

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: true,
  devtools: { enabled: false },
  nitro: {
    preset: 'node-server',
    publicAssets: [{ dir: fileURLToPath(new URL('./public', import.meta.url)), baseURL: '/' }],
  },
  hooks: {
    async 'build:before'() {
      await preparePublication({
        appDir: fileURLToPath(new URL('.', import.meta.url)),
        siteUrl: process.env.SITE_URL ?? 'http://127.0.0.1:4173',
        showcase: exhibits,
        approvedRoutes: ['/en/exhibits/compass', '/fr/exhibits/boussole'],
      });
    },
  },
});
