import { readPage } from '../../lib/catalog.server.js';
export function load({ url }) {
  return { page: readPage(url.pathname) };
}
