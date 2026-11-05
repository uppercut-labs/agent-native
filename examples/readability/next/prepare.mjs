import { preparePublication } from '../shared/publication.mjs';
import { modules } from './course.mjs';
await preparePublication({
  appDir: import.meta.dirname,
  showcase: modules,
  approvedRoutes: ['/courses/field-recording'],
});
