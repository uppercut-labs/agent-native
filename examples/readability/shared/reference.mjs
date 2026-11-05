// Both editions are checked-in inputs. Edit the answer source here, then rebuild each app.
export function reference(edition, proofCode) {
  if (proofCode !== undefined && !/^[A-Za-z0-9]{12,64}$/.test(proofCode))
    throw Error('Expected a synthetic release proof code (12–64 letters/digits)');
  const currentCode = proofCode ? ' The current departure code is ' + proofCode + '.' : '';
  if (!['original', 'updated'].includes(edition)) throw new Error('Unknown reference edition');
  const original = edition === 'original';
  const page = (id, route, title, markdown, links = []) => ({
    id,
    route,
    title,
    markdown,
    links,
    revision: edition,
    visibility: 'public',
    category: 'Harbor field guide',
    structuredType: 'Article',
  });
  return [
    page(
      'reference-index',
      '/guides/getting-started',
      'Harbor field guide',
      'Consult the route cards for the departure pier of each morning crossing.',
      ['meridian', 'harbor', ...(original ? ['retired'] : [])],
    ),
    page(
      'meridian',
      '/guides/meridian',
      'Meridian crossing',
      `The Meridian crossing departs from ${original ? 'Pier Four' : 'Pier Seven'} at 08:15.` +
        currentCode,
      ['harbor'],
    ),
    page(
      'harbor',
      '/guides/harbor',
      'Harbor crossing',
      'The Harbor crossing departs from Pier Two at 08:45.',
      ['meridian'],
    ),
    ...(original
      ? [
          page(
            'retired',
            '/guides/retired',
            'Retired connector',
            'The retired connector serves the dry dock.',
          ),
        ]
      : []),
    { id: 'account', revision: edition, route: '/account/settings', visibility: 'authenticated' },
    {
      id: 'draft',
      revision: edition,
      route: '/draft/inspection',
      visibility: 'draft',
      markdown: 'PRIVATE-DRAFT-SOUNDER-3191',
    },
  ];
}

export const reviewedReferenceRoutes = [
  '/guides/getting-started',
  '/guides/meridian',
  '/guides/harbor',
  '/guides/retired',
];
