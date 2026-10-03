import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenariosFile = path.join(projectRoot, 'fixtures', 'scenarios.json');
const CURRENT_REVISION = 'e11-fixture-v1';
const LOCAL_HEALTH_URL = 'http://127.0.0.1:8787/health';
const CLOSED_LOOPBACK_URL = 'http://127.0.0.1:1/health';

export async function listScenarios() {
  const manifest = JSON.parse(await readFile(scenariosFile, 'utf8'));
  return manifest.scenarios;
}

function baseConfig(scenarioId, variant) {
  return {
    schemaVersion: 1,
    scenarioId,
    variant,
    expectedRevision: CURRENT_REVISION,
    projectRoots: ['app'],
    bindings: [
      { capabilityId: 'example:catalog.read@1', mode: 'read', handler: 'handlers/read.mjs' },
      {
        capabilityId: 'example:catalog.erase@1',
        mode: 'mutation',
        handler: 'handlers/destructive-canary.mjs',
        requiresExplicitInvocation: true,
      },
    ],
    authorization: {
      requiredScope: 'catalog:read',
      grantedScopes: ['catalog:read'],
      credentialFile: 'credentials/test-auth.json',
    },
    browser: { requiredFeature: 'webmcp', availableFeatures: ['webmcp'] },
    network: { endpoint: LOCAL_HEALTH_URL },
  };
}

export async function launchFixture(scenarioId, { variant = 'fault' } = {}) {
  const scenarios = await listScenarios();
  if (!scenarios.some((scenario) => scenario.id === scenarioId)) {
    throw new TypeError(`Unknown E11 scenario: ${scenarioId}`);
  }
  if (variant !== 'fault' && variant !== 'repaired') {
    throw new TypeError('variant must be fault or repaired');
  }

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-native-e11-'));
  const config = baseConfig(scenarioId, variant);
  let artifactRevision = CURRENT_REVISION;
  let includeCredential = true;

  if (variant === 'fault') {
    switch (scenarioId) {
      case 'missing-binding':
        config.bindings = config.bindings.filter(
          (binding) => binding.capabilityId !== 'example:catalog.read@1',
        );
        break;
      case 'stale-artifact':
        artifactRevision = 'e11-fixture-v0';
        break;
      case 'ambiguous-root':
        config.projectRoots.push('legacy');
        break;
      case 'insufficient-scope':
        config.authorization.grantedScopes = [];
        break;
      case 'unsupported-browser':
        config.browser.availableFeatures = [];
        break;
      case 'missing-credentials':
        includeCredential = false;
        break;
      case 'unreachable-endpoint':
        config.network.endpoint = CLOSED_LOOPBACK_URL;
        break;
      case 'no-endpoint':
        config.network.endpoint = null;
        break;
      default:
        throw new Error('Scenario manifest and fixture launcher disagree.');
    }
  }

  for (const directory of ['artifacts', 'credentials', 'data', 'handlers', 'roots/app']) {
    await mkdir(path.join(sandboxRoot, directory), { recursive: true });
  }
  if (config.projectRoots.includes('legacy')) {
    await mkdir(path.join(sandboxRoot, 'roots', 'legacy'), { recursive: true });
    await writeFile(path.join(sandboxRoot, 'roots', 'legacy', 'project.marker'), 'legacy\n');
  }
  await writeFile(path.join(sandboxRoot, 'roots', 'app', 'project.marker'), 'app\n');
  await writeFile(path.join(sandboxRoot, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(
    path.join(sandboxRoot, 'artifacts', 'catalog.generated.json'),
    `${JSON.stringify({ revision: artifactRevision }, null, 2)}\n`,
  );
  await writeFile(
    path.join(sandboxRoot, 'data', 'catalog.json'),
    '{"items":[{"id":"fixture-album","title":"Local Fixture"}]}\n',
  );
  if (includeCredential) {
    await writeFile(
      path.join(sandboxRoot, 'credentials', 'test-auth.json'),
      '{"kind":"fixture-only","value":"not-a-real-secret"}\n',
    );
  }
  for (const handler of ['read.mjs', 'destructive-canary.mjs']) {
    await copyFile(
      path.join(projectRoot, 'src', 'handlers', handler),
      path.join(sandboxRoot, 'handlers', handler),
    );
  }
  return { sandboxRoot, scenarioId, variant };
}
