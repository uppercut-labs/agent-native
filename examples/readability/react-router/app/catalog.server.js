import model from '../generated/publication.json';
export function readPage(route) {
  const page = model.pages.find(
    (item) => item.route.replace(/\/$/, '') === route.replace(/\/$/, ''),
  );
  if (!page) throw new Response('Page not found', { status: 404 });
  return page;
}
