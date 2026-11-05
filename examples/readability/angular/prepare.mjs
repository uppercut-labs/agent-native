import { rm } from 'node:fs/promises';
import { preparePublication } from '../shared/publication.mjs';

const models = [
  { slug: 'atlas-7', name: 'Atlas 7', instruction: 'Set the torque collar to 18 Nm before use.' },
  { slug: 'atlas-9', name: 'Atlas 9', instruction: 'Set the torque collar to 24 Nm before use.' },
];
const showcase = models.map(({ slug, name, instruction }) => ({
  id: slug,
  revision: 'manual-4',
  route: '/equipment/' + slug,
  visibility: 'public',
  title: name + ' operator handbook',
  markdown: instruction,
  structuredType: 'Article',
  category: 'Equipment handbooks',
}));
showcase.push({
  id: 'atlas-service',
  revision: 'service-2',
  route: '/service/atlas-7',
  visibility: 'authenticated',
  markdown: 'SERVICE-ONLY-CALIBRATION-6914',
});
await preparePublication({
  appDir: new URL('./', import.meta.url),
  showcase,
  approvedRoutes: ['/equipment/atlas-7', '/equipment/atlas-9'],
});

// This directory is exclusively the fixture's compiled host tree. Publish a fresh
// tree so a retired prerendered route or mirror cannot survive an incremental build.
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
