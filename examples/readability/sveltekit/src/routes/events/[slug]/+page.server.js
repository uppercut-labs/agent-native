import { readPage } from '../../../lib/catalog.server.js';
export function load({ params }) {
  return { page: readPage(`/events/${params.slug}`) };
}
