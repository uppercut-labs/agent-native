import assert from 'node:assert/strict';
import { GET as getCatalog } from '../app/api/catalog/route.js';
import { GET as getSavedList } from '../app/api/saved-list/route.js';

const catalogResponse = await getCatalog(new Request('http://localhost/api/catalog'));
assert.equal(catalogResponse.status, 200);
assert.match(catalogResponse.headers.get('content-type') ?? '', /^application\/json/);
const catalogBody = await catalogResponse.json();
assert.equal(catalogBody.items.length, 4);
assert.deepEqual(
  catalogBody.items.map((book) => book.id),
  ['the-left-hand-of-darkness', 'braiding-sweetgrass', 'the-dispossessed', 'invisible-cities'],
);

const alexResponse = await getSavedList(
  new Request('http://localhost/api/saved-list?ownerUserId=reader-mina', {
    headers: { authorization: 'Bearer fixture-session-alex' },
  }),
);
assert.equal(alexResponse.status, 200);
assert.equal(alexResponse.headers.get('cache-control'), 'private, no-store');
assert.deepEqual(await alexResponse.json(), { items: ['braiding-sweetgrass'] });

const invalidSession = await getSavedList(
  new Request('http://localhost/api/saved-list', {
    headers: { authorization: 'Bearer reader-mina' },
  }),
);
assert.equal(invalidSession.status, 401);
assert.deepEqual(await invalidSession.json(), {
  error: { code: 'unauthorized', message: 'A valid fixture session is required.' },
});

console.log(
  'route smoke: catalog and fixture-session saved-list routes returned expected responses',
);
