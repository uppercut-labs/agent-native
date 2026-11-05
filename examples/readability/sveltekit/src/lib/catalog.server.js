import { error } from '@sveltejs/kit';
import model from '../../generated/publication.json';
export function readPage(route) {
  const page = model.pages.find(
    (item) => item.route.replace(/\/$/, '') === route.replace(/\/$/, ''),
  );
  if (!page) error(404, 'Page not found');
  return page;
}
