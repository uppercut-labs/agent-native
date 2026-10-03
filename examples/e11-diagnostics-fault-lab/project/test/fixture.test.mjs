import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { launchFixture, listScenarios } from '../src/fixture.mjs';

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function loadSandbox(sandboxRoot) {
  const config = JSON.parse(await readFile(path.join(sandboxRoot, 'project.json'), 'utf8'));
  const artifact = JSON.parse(
    await readFile(path.join(sandboxRoot, 'artifacts', 'catalog.generated.json'), 'utf8'),
  );
  return { config, artifact };
}

const expectations = {
  'missing-binding': async ({ config }) => {
    assert.equal(
      config.bindings.some((binding) => binding.capabilityId === 'example:catalog.read@1'),
      false,
    );
  },
  'stale-artifact': async ({ config, artifact }) => {
    assert.notEqual(artifact.revision, config.expectedRevision);
  },
  'ambiguous-root': async ({ config }, root) => {
    assert.deepEqual(config.projectRoots, ['app', 'legacy']);
    assert.equal(await exists(path.join(root, 'roots', 'legacy', 'project.marker')), true);
  },
  'insufficient-scope': async ({ config }) => {
    assert.equal(
      config.authorization.grantedScopes.includes(config.authorization.requiredScope),
      false,
    );
  },
  'unsupported-browser': async ({ config }) => {
    assert.equal(config.browser.availableFeatures.includes(config.browser.requiredFeature), false);
  },
  'missing-credentials': async (_, root) => {
    assert.equal(await exists(path.join(root, 'credentials', 'test-auth.json')), false);
  },
  'unreachable-endpoint': async ({ config }) => {
    assert.equal(new URL(config.network.endpoint).port, '1');
  },
  'no-endpoint': async ({ config }) => {
    assert.equal(config.network.endpoint, null);
  },
};

test('every scenario materializes its fault and a repairable counterpart without invoking the canary', async () => {
  const scenarios = await listScenarios();
  assert.deepEqual(scenarios.map(({ id }) => id).sort(), Object.keys(expectations).sort());
  const roots = [];
  try {
    for (const { id } of scenarios) {
      const fault = await launchFixture(id);
      const repaired = await launchFixture(id, { variant: 'repaired' });
      roots.push(fault.sandboxRoot, repaired.sandboxRoot);
      const faultState = await loadSandbox(fault.sandboxRoot);
      const repairedState = await loadSandbox(repaired.sandboxRoot);
      await expectations[id](faultState, fault.sandboxRoot);
      assert.equal(
        repairedState.config.bindings.some(
          (binding) => binding.capabilityId === 'example:catalog.read@1',
        ),
        true,
      );
      assert.equal(repairedState.artifact.revision, repairedState.config.expectedRevision);
      assert.deepEqual(repairedState.config.projectRoots, ['app']);
      assert.ok(repairedState.config.authorization.grantedScopes.includes('catalog:read'));
      assert.ok(repairedState.config.browser.availableFeatures.includes('webmcp'));
      assert.equal(
        await exists(path.join(repaired.sandboxRoot, 'credentials', 'test-auth.json')),
        true,
      );
      assert.equal(new URL(repairedState.config.network.endpoint).port, '8787');
      for (const root of [fault.sandboxRoot, repaired.sandboxRoot]) {
        const state = await loadSandbox(root);
        const canary = state.config.bindings.find(
          (binding) => binding.capabilityId === 'example:catalog.erase@1',
        );
        assert.equal(canary?.mode, 'mutation');
        assert.equal(canary?.requiresExplicitInvocation, true);
        assert.equal(await exists(path.join(root, canary.handler)), true);
        assert.equal(await exists(path.join(root, 'data', 'catalog.json')), true);
        assert.equal(await exists(path.join(root, 'canary-invoked.marker')), false);
      }
    }
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
});

test('unknown scenario and invalid variant do not create a sandbox', async () => {
  await assert.rejects(() => launchFixture('unknown'), /Unknown E11 scenario/);
  await assert.rejects(
    () => launchFixture('missing-binding', { variant: 'passed' }),
    /variant must/,
  );
});

test('canary refuses paths outside generated fixture sandboxes', async () => {
  const { destructiveCanary } = await import('../src/handlers/destructive-canary.mjs');
  await assert.rejects(() => destructiveCanary(process.cwd()), /generated fixture sandbox/);
});
