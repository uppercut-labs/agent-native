import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import worker from '../src/index.mjs';
import { catalogRevision, registry } from '../src/catalog.mjs';
import { getAlbumCapability } from '../src/catalog-contract.mjs';

const env = {
  SIDECAR_HOST: 'sidecar.test',
  ALLOWED_ORIGIN: 'https://catalog.test',
  CATALOG_REVISION: catalogRevision,
};
const req = (path, headers = {}) =>
  new Request('https://sidecar.test' + path, { headers: { host: 'sidecar.test', ...headers } });

test('health distinguishes configured, missing, and mismatched revision binding', async () => {
  const ok = await worker.fetch(req('/health', { origin: env.ALLOWED_ORIGIN }), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  assert.equal((await ok.json()).catalogRevision, catalogRevision);
  const missing = await worker.fetch(req('/health'), { ...env, CATALOG_REVISION: undefined });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, 'missing_catalog_binding');
  const mismatch = await worker.fetch(req('/health'), { ...env, CATALOG_REVISION: 'other' });
  assert.equal(mismatch.status, 503);
  assert.equal((await mismatch.json()).code, 'catalog_revision_mismatch');
});

test('Host and Origin use configured allowlists and deny unconfigured routes', async () => {
  assert.equal((await worker.fetch(req('/health', { host: 'attacker.test' }), env)).status, 421);
  const deniedOrigin = await worker.fetch(req('/health', { origin: 'https://attacker.test' }), env);
  assert.equal(deniedOrigin.status, 403);
  assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);
  const missingHost = await worker.fetch(req('/health'), {
    ALLOWED_ORIGIN: env.ALLOWED_ORIGIN,
    CATALOG_REVISION: env.CATALOG_REVISION,
  });
  assert.equal(missingHost.status, 421);
  const missingRoute = await worker.fetch(req('/not-routed'), env);
  assert.equal(missingRoute.status, 404);
  assert.equal((await missingRoute.json()).error.code, 'route_not_configured');
});

test('Wrangler binding and Worker registry use the shared catalog artifact revision', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.vars.CATALOG_REVISION, catalogRevision);
});

test('Worker registry uses the exact shared E01 capability contract', () => {
  assert.equal(registry.definitions.length, 1);
  assert.equal(registry.definitions[0], getAlbumCapability);
  assert.deepEqual(
    registry.definitions[0].input.toJSONSchema(),
    getAlbumCapability.input.toJSONSchema(),
  );
  assert.deepEqual(
    registry.definitions[0].output.toJSONSchema(),
    getAlbumCapability.output.toJSONSchema(),
  );
});
