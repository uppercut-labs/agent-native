import { fileURLToPath } from 'node:url';
import { preparePublication } from '../shared/publication.mjs';
import { showcase } from './showcase.mjs';
await preparePublication({
  appDir: fileURLToPath(new URL('.', import.meta.url)),
  siteUrl: process.env.SITE_URL,
  approvedRoutes: ['/lines/river/stops/quay'],
  showcase,
  assetDir: 'public',
});
