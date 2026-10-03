import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diagnoseFixture } from '../src/doctor.mjs';
import { launchFixture, listScenarios } from '../src/fixture.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const diagnosticIds = {
  'missing-binding': 'UAN-019.binding-configured',
  'stale-artifact': 'UAN-019.artifact-current',
  'ambiguous-root': 'UAN-019.project-root-unambiguous',
  'insufficient-scope': 'UAN-019.scope-configured',
  'unsupported-browser': 'UAN-019.browser-feature-configured',
  'missing-credentials': 'UAN-019.credentials-configured',
  'unreachable-endpoint': 'UAN-019.endpoint-reachable',
  'no-endpoint': 'UAN-019.endpoint-reachable',
};

test('doctor detects and repairs all eight scenarios without invoking handlers', async () => {
  const scenarios = await listScenarios();
  const roots = [];
  const forbiddenFetch = async () => {
    throw new Error('default doctor must not access the network');
  };
  try {
    for (const { id } of scenarios) {
      const fault = await launchFixture(id);
      const repaired = await launchFixture(id, { variant: 'repaired' });
      roots.push(fault.sandboxRoot, repaired.sandboxRoot);
      const faultReport = await diagnoseFixture(fault.sandboxRoot, { fetch: forbiddenFetch });
      const repairedReport = await diagnoseFixture(repaired.sandboxRoot, {
        fetch: forbiddenFetch,
      });
      const diagnosticId = diagnosticIds[id];
      const faultFinding = faultReport.findings.find((finding) => finding.checkId === diagnosticId);
      const repairedFinding = repairedReport.findings.find(
        (finding) => finding.checkId === diagnosticId,
      );

      assert.equal(
        faultFinding.status,
        id === 'unreachable-endpoint' ? 'skipped' : id === 'no-endpoint' ? 'unknown' : 'failed',
        id,
      );
      assert.equal(
        repairedFinding.status,
        id === 'unreachable-endpoint' || id === 'no-endpoint' ? 'skipped' : 'passed',
        id,
      );
      assert.equal(
        faultReport.exitCode,
        id === 'unreachable-endpoint' || id === 'no-endpoint' ? 3 : 1,
      );
      assert.equal(await exists(path.join(fault.sandboxRoot, 'data', 'catalog.json')), true);
      assert.equal(await exists(path.join(fault.sandboxRoot, 'canary-invoked.marker')), false);
      assert.equal(await exists(path.join(repaired.sandboxRoot, 'data', 'catalog.json')), true);
      assert.equal(await exists(path.join(repaired.sandboxRoot, 'canary-invoked.marker')), false);
    }
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
});

test('network diagnostics require opt-in and distinguish protocol evidence', async () => {
  const roots = [];
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', source: 'e11-local-fixture' }));
  });
  try {
    const unreachable = await launchFixture('unreachable-endpoint');
    const repaired = await launchFixture('unreachable-endpoint', { variant: 'repaired' });
    const absent = await launchFixture('no-endpoint');
    roots.push(unreachable.sandboxRoot, repaired.sandboxRoot, absent.sandboxRoot);

    const unreachableReport = await diagnoseFixture(unreachable.sandboxRoot, {
      probeLoopback: true,
      fetch: async (_url, options) => {
        assert.equal(options.redirect, 'error');
        throw new TypeError('connection refused');
      },
    });
    assert.equal(
      unreachableReport.findings.find((finding) => finding.checkId === 'UAN-019.endpoint-reachable')
        .status,
      'failed',
    );
    assert.equal(
      unreachableReport.findings.find((finding) => finding.checkId === 'UAN-019.endpoint-reachable')
        .evidence.source,
      'mock',
    );
    assert.equal(
      unreachableReport.findings.find((finding) => finding.checkId === 'UAN-019.health-protocol')
        .status,
      'unknown',
    );

    let loopbackAvailable = true;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      loopbackAvailable = false;
    }
    let repairedReport;
    if (loopbackAvailable) {
      const address = server.address();
      assert.notEqual(address, null);
      assert.equal(typeof address, 'object');
      const configPath = path.join(repaired.sandboxRoot, 'project.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      config.network.endpoint = `http://127.0.0.1:${address.port}/health`;
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      repairedReport = await diagnoseFixture(repaired.sandboxRoot, { probeLoopback: true });
    } else {
      repairedReport = await diagnoseFixture(repaired.sandboxRoot, {
        probeLoopback: true,
        fetch: async () =>
          new Response(JSON.stringify({ status: 'ok', source: 'e11-local-fixture' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      });
    }
    assert.equal(
      repairedReport.findings.find((finding) => finding.checkId === 'UAN-019.endpoint-reachable')
        .status,
      'passed',
    );
    assert.equal(
      repairedReport.findings.find((finding) => finding.checkId === 'UAN-019.health-protocol')
        .status,
      'passed',
    );
    assert.equal(
      repairedReport.findings.find((finding) => finding.checkId === 'UAN-019.health-protocol')
        .evidence.source,
      loopbackAvailable ? 'fixture' : 'mock',
    );
    assert.equal(repairedReport.exitCode, 0);

    const absentReport = await diagnoseFixture(absent.sandboxRoot, {
      probeLoopback: true,
      fetch: async () => {
        throw new Error('must not probe without an endpoint');
      },
    });
    assert.equal(
      absentReport.findings.find((finding) => finding.checkId === 'UAN-019.endpoint-reachable')
        .status,
      'unknown',
    );
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
});

test('local profile passes repaired configuration while full profile still requires network evidence', async () => {
  const { sandboxRoot } = await launchFixture('missing-binding', { variant: 'repaired' });
  try {
    const forbiddenFetch = async () => {
      throw new Error('local profile must not access the network');
    };
    const local = await diagnoseFixture(sandboxRoot, {
      profile: 'local',
      probeLoopback: true,
      fetch: forbiddenFetch,
    });
    assert.equal(local.schemaVersion, 'uan.doctor-report/v1');
    assert.equal(local.profile.id, 'local');
    assert.equal(local.findings.length, 6);
    assert.equal(local.exitCode, 0);
    assert.equal(
      local.findings.some(({ checkId }) => checkId === 'UAN-019.endpoint-reachable'),
      false,
    );
    const full = await diagnoseFixture(sandboxRoot, { profile: 'full', fetch: forbiddenFetch });
    assert.equal(full.profile.id, 'full');
    assert.equal(full.findings.length, 8);
    assert.equal(full.exitCode, 3);
    await assert.rejects(() => diagnoseFixture(sandboxRoot, { profile: '__proto__' }), TypeError);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test('E11 CLI selects a profile and preserves machine exits', async () => {
  const run = (args) =>
    spawnSync(process.execPath, ['src/cli.mjs', 'doctor', 'missing-binding', ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
  const local = run(['--repaired', '--profile', 'local']);
  assert.equal(local.status, 0, local.stderr);
  const localReport = JSON.parse(local.stdout);
  try {
    assert.equal(localReport.schemaVersion, 'uan.doctor-report/v1');
    assert.equal(localReport.profile.id, 'local');
    assert.equal(localReport.exitCode, 0);
  } finally {
    await rm(localReport.sandboxRoot, { recursive: true, force: true });
  }
  const full = run(['--repaired']);
  assert.equal(full.status, 3, full.stderr);
  const fullReport = JSON.parse(full.stdout);
  try {
    assert.equal(fullReport.profile.id, 'full');
    assert.equal(fullReport.exitCode, 3);
  } finally {
    await rm(fullReport.sandboxRoot, { recursive: true, force: true });
  }
  const invalid = run(['--profile', 'unknown']);
  assert.equal(invalid.status, 2);
});
