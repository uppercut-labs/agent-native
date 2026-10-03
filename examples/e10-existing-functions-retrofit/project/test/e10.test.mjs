import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createOpenApiDocument } from '@uppercut-labs/agent-native/http';
import { registry } from '../src/capability.mjs';
import { createContentServer } from '../src/http.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

async function withServer(run) {
  const server = createContentServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('generated GET route preserves search and unrelated reads', async () => {
  await withServer(async (base) => {
    const search = await fetch(base + '/api/content/search?q=night&limit=1');
    assert.equal(search.status, 200);
    assert.deepEqual(
      (await search.json()).results.map(({ slug }) => slug),
      ['night-drive'],
    );
    const item = await fetch(base + '/api/content/city-map');
    assert.equal(item.status, 200);
    assert.equal((await item.json()).title, 'City Map');
    const health = await fetch(base + '/api/health');
    assert.deepEqual(await health.json(), { status: 'ok' });
  });
});

test('generated GET route rejects invalid input and mutation attempts', async () => {
  await withServer(async (base) => {
    for (const path of ['/api/content/search', '/api/content/search?q=night&limit=1.5']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error.code, 'invalid_input');
    }
    const mutation = await fetch(base + '/api/content/search?q=night', { method: 'POST' });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET');
  });
});

test('generated CLI resolves both the established command and alias', () => {
  const outputs = ['content-search', 'search'].map((command) =>
    spawnSync(
      process.execPath,
      [cli, command, '--mode', 'local', '--query', 'night', '--limit', '1'],
      { encoding: 'utf8' },
    ),
  );
  for (const output of outputs) {
    assert.equal(output.status, 0, output.stderr);
    const envelope = JSON.parse(output.stdout);
    assert.equal(envelope.result.capabilityId, 'content:search@1');
    assert.deepEqual(
      envelope.result.value.results.map(({ slug }) => slug),
      ['night-drive'],
    );
  }
  assert.equal(outputs[0].stdout, outputs[1].stdout);

  const invalid = spawnSync(process.execPath, [cli, 'search', '--mode', 'local', '--query', ''], {
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).result.reason, 'invalid-input');
});

test('OpenAPI describes the established GET route and query mapping', () => {
  const document = createOpenApiDocument(registry);
  const operation = document.paths['/api/content/search'].get;
  assert.equal(operation['x-agent-native-capability-id'], 'content:search@1');
  assert.equal(operation.requestBody, undefined);
  assert.deepEqual(
    operation.parameters.map(({ name, required }) => ({ name, required })),
    [
      { name: 'q', required: true },
      { name: 'limit', required: false },
    ],
  );
});
