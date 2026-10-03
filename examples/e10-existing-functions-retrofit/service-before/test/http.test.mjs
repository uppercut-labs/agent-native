import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentServer } from '../src/http.mjs';

async function withServer(run) {
  const server = createContentServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  }
}

test('the established GET search path and unrelated reads work', async () => {
  await withServer(async (base) => {
    const search = await fetch(base + '/api/content/search?q=night');
    assert.equal(search.status, 200);
    assert.deepEqual(
      (await search.json()).results.map(({ slug }) => slug),
      ['night-drive', 'night-market'],
    );

    const item = await fetch(base + '/api/content/city-map');
    assert.equal(item.status, 200);
    assert.equal((await item.json()).title, 'City Map');

    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
  });
});

test('invalid searches and attempted mutations have explicit failures', async () => {
  await withServer(async (base) => {
    const missingQuery = await fetch(base + '/api/content/search');
    assert.equal(missingQuery.status, 400);
    assert.equal((await missingQuery.json()).error, 'invalid_search');

    const badLimit = await fetch(base + '/api/content/search?q=night&limit=1.5');
    assert.equal(badLimit.status, 400);
    assert.equal((await badLimit.json()).error, 'invalid_search');

    const mutation = await fetch(base + '/api/content/search?q=night', {
      method: 'POST',
    });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET');
    assert.deepEqual(await mutation.json(), { error: 'method_not_allowed' });

    const missingItem = await fetch(base + '/api/content/missing');
    assert.equal(missingItem.status, 404);
  });
});
