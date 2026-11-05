// The collection supplies both Nuxt's human pages and the reviewed public projection.
const entries = [
  ['en-compass', 'en', 'compass', 'Harbor compass', 'The compass entered the collection in 1937.'],
  [
    'fr-boussole',
    'fr',
    'boussole',
    'Boussole du port',
    'La boussole est entrée dans la collection en 1937.',
  ],
];
export const exhibits = entries.map(([id, locale, slug, title, markdown]) => ({
  id,
  locale,
  route: `/${locale}/exhibits/${slug}`,
  title,
  markdown,
  revision: 'r1',
  visibility: 'public',
  category: 'Museum collection',
  structuredType: 'WebPage',
}));
export const withdrawn = '/fr/exhibits/carte';
