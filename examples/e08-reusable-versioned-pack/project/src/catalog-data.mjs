const albums = Object.freeze({
  kindOfBlue: Object.freeze({
    slug: 'kind-of-blue',
    titles: Object.freeze({ 'en-US': 'Kind of Blue', 'fr-FR': 'Kind of Blue' }),
  }),
});

export function lookupAlbum(slug) {
  const album = Object.values(albums).find((candidate) => candidate.slug === slug);
  if (album === undefined) throw new TypeError(`unknown album ${slug}`);
  return album;
}
