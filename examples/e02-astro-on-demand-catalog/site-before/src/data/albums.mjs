export const albums = Object.freeze([
  Object.freeze({
    slug: 'after-the-rain',
    title: 'After the Rain',
    artist: 'Mara Vale',
    year: 1978,
    format: 'LP',
    summary: 'Patient electric piano, brushed drums, and a final track that opens into daylight.',
  }),
  Object.freeze({
    slug: 'night-bus-radio',
    title: 'Night Bus Radio',
    artist: 'The Meridian Lines',
    year: 1983,
    format: 'LP',
    summary: 'Lean post-punk recorded between the last train and the first morning bus.',
  }),
  Object.freeze({
    slug: 'small-hours-atlas',
    title: 'Small Hours Atlas',
    artist: 'June Static',
    year: 1996,
    format: 'CD',
    summary: 'Field recordings and close-miked folk songs arranged like entries in a travel log.',
  }),
]);

export function findAlbumBySlug(slug) {
  return albums.find((album) => album.slug === slug);
}
