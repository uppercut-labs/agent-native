import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runDoctor } from '@uppercut-labs/agent-native/doctor';

const READ_CAPABILITY = 'example:catalog.read@1';
const EVIDENCE = {
  binding: 'E11.BINDING.CONFIG',
  artifact: 'E11.ARTIFACT.REVISION',
  root: 'E11.PROJECT.ROOTS',
  scope: 'E11.AUTH.SCOPE',
  browser: 'E11.BROWSER.FEATURE',
  credentials: 'E11.AUTH.CREDENTIALS',
  endpoint: 'E11.NETWORK.ENDPOINT',
  protocol: 'E11.NETWORK.HEALTH',
};
const LOCAL_CHECK_IDS = [
  'UAN-019.binding-configured',
  'UAN-019.artifact-current',
  'UAN-019.project-root-unambiguous',
  'UAN-019.scope-configured',
  'UAN-019.browser-feature-configured',
  'UAN-019.credentials-configured',
];
const FULL_CHECK_IDS = [
  ...LOCAL_CHECK_IDS,
  'UAN-019.endpoint-reachable',
  'UAN-019.health-protocol',
];
// docs:start doctor-profiles
export const E11_DOCTOR_PROFILES = Object.freeze({
  local: Object.freeze({
    id: 'local',
    selectedCheckIds: Object.freeze(LOCAL_CHECK_IDS),
    requiredCheckIds: Object.freeze([...LOCAL_CHECK_IDS]),
  }),
  full: Object.freeze({
    id: 'full',
    selectedCheckIds: Object.freeze(FULL_CHECK_IDS),
    requiredCheckIds: Object.freeze([...FULL_CHECK_IDS]),
  }),
});
// docs:end doctor-profiles

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function check({
  checkId,
  target,
  kind,
  source = 'fixture',
  location,
  explanations,
  nextAction,
  observe,
}) {
  return {
    checkId,
    target,
    required: true,
    severity: 'error',
    evidence: { kind, source, location },
    explanations,
    nextAction,
    observe,
  };
}

function result(status, reference) {
  return { status, evidenceRefs: [reference] };
}

function isLoopbackHttp(endpoint) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'http:' &&
      url.username === '' &&
      url.password === '' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

async function networkEvidence(endpoint, { probeLoopback, fetch }) {
  if (endpoint === null) return { reachable: 'unknown', protocol: 'unknown' };
  if (!probeLoopback) return { reachable: 'skipped', protocol: 'skipped' };
  if (!isLoopbackHttp(endpoint)) return { reachable: 'unknown', protocol: 'unknown' };
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(1_000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return {
      reachable: 'passed',
      protocol:
        response.status === 200 && body?.status === 'ok' && body?.source === 'e11-local-fixture'
          ? 'passed'
          : 'failed',
    };
  } catch {
    return { reachable: 'failed', protocol: 'unknown' };
  }
}

export async function diagnoseFixture(
  sandboxRoot,
  { profile = 'full', probeLoopback = false, fetch = globalThis.fetch, now } = {},
) {
  const selectedProfile =
    profile === 'local'
      ? E11_DOCTOR_PROFILES.local
      : profile === 'full'
        ? E11_DOCTOR_PROFILES.full
        : undefined;
  if (selectedProfile === undefined)
    throw new TypeError('E11 doctor profile must be local or full');
  const root = path.resolve(sandboxRoot);
  const configLocation = path.join(root, 'project.json');
  const artifactLocation = path.join(root, 'artifacts', 'catalog.generated.json');
  const config = JSON.parse(await readFile(configLocation, 'utf8'));
  const artifact = JSON.parse(await readFile(artifactLocation, 'utf8'));
  const target = `e11:${config.scenarioId}:${config.variant}`;
  const credentialLocation = path.join(root, config.authorization.credentialFile);
  const configuredRoots = await Promise.all(
    config.projectRoots.map((candidate) =>
      exists(path.join(root, 'roots', candidate, 'project.marker')),
    ),
  );
  const network =
    selectedProfile.id === 'full'
      ? await networkEvidence(config.network.endpoint, { probeLoopback, fetch })
      : { reachable: 'skipped', protocol: 'skipped' };
  const networkSource =
    probeLoopback && config.network.endpoint !== null && fetch !== globalThis.fetch
      ? 'mock'
      : 'fixture';

  return runDoctor(
    [
      check({
        checkId: 'UAN-019.binding-configured',
        target,
        kind: 'configured',
        location: configLocation,
        explanations: {
          passed: 'The required read binding is configured.',
          failed: 'The required read binding is missing.',
          unknown: 'Binding configuration evidence is unavailable.',
          skipped: 'Binding configuration inspection was skipped.',
        },
        nextAction: `Configure ${READ_CAPABILITY} in project.json.`,
        observe: () =>
          result(
            config.bindings.some((binding) => binding.capabilityId === READ_CAPABILITY)
              ? 'passed'
              : 'failed',
            EVIDENCE.binding,
          ),
      }),
      check({
        checkId: 'UAN-019.artifact-current',
        target,
        kind: 'generated',
        location: artifactLocation,
        explanations: {
          passed: 'The generated artifact matches the configured revision.',
          failed: 'The generated artifact is stale.',
          unknown: 'Generated artifact evidence is unavailable.',
          skipped: 'Generated artifact inspection was skipped.',
        },
        nextAction: 'Regenerate artifacts/catalog.generated.json.',
        observe: () =>
          result(
            artifact.revision === config.expectedRevision ? 'passed' : 'failed',
            EVIDENCE.artifact,
          ),
      }),
      check({
        checkId: 'UAN-019.project-root-unambiguous',
        target,
        kind: 'configured',
        location: path.join(root, 'roots'),
        explanations: {
          passed: 'Exactly one configured project root exists.',
          failed: 'Multiple configured project roots exist.',
          unknown: 'Project root evidence is unavailable.',
          skipped: 'Project root inspection was skipped.',
        },
        nextAction: 'Select one project root and remove obsolete candidates.',
        observe: () =>
          result(configuredRoots.filter(Boolean).length === 1 ? 'passed' : 'failed', EVIDENCE.root),
      }),
      check({
        checkId: 'UAN-019.scope-configured',
        target,
        kind: 'configured',
        location: configLocation,
        explanations: {
          passed: 'The fixture identity has the required scope.',
          failed: 'The fixture identity lacks the required scope.',
          unknown: 'Authorization scope evidence is unavailable.',
          skipped: 'Authorization scope inspection was skipped.',
        },
        nextAction: `Grant ${config.authorization.requiredScope} to the fixture identity.`,
        observe: () =>
          result(
            config.authorization.grantedScopes.includes(config.authorization.requiredScope)
              ? 'passed'
              : 'failed',
            EVIDENCE.scope,
          ),
      }),
      check({
        checkId: 'UAN-019.browser-feature-configured',
        target,
        kind: 'configured',
        location: configLocation,
        explanations: {
          passed: 'The browser advertises the required fixture feature.',
          failed: 'The browser does not advertise the required fixture feature.',
          unknown: 'Browser configuration evidence is unavailable.',
          skipped: 'Browser configuration inspection was skipped.',
        },
        nextAction: `Use an adapter that advertises ${config.browser.requiredFeature}.`,
        observe: () =>
          result(
            config.browser.availableFeatures.includes(config.browser.requiredFeature)
              ? 'passed'
              : 'failed',
            EVIDENCE.browser,
          ),
      }),
      check({
        checkId: 'UAN-019.credentials-configured',
        target,
        kind: 'configured',
        location: credentialLocation,
        explanations: {
          passed: 'The configured fixture credential file exists.',
          failed: 'The configured fixture credential file is missing.',
          unknown: 'Credential configuration evidence is unavailable.',
          skipped: 'Credential configuration inspection was skipped.',
        },
        nextAction: 'Create the fixture-only credential file without exposing its contents.',
        observe: async () =>
          result((await exists(credentialLocation)) ? 'passed' : 'failed', EVIDENCE.credentials),
      }),
      check({
        checkId: 'UAN-019.endpoint-reachable',
        target,
        kind: 'reachable',
        source: networkSource,
        location: config.network.endpoint ?? configLocation,
        explanations: {
          passed: 'The opted-in loopback endpoint accepted a connection.',
          failed: 'The opted-in loopback endpoint could not be reached.',
          unknown: 'No safe loopback endpoint is configured, so reachability is unknown.',
          skipped: 'The loopback network probe was not explicitly enabled.',
        },
        nextAction: 'Configure a loopback endpoint and rerun with --probe-loopback.',
        observe: () => result(network.reachable, EVIDENCE.endpoint),
      }),
      check({
        checkId: 'UAN-019.health-protocol',
        target,
        kind: 'protocol',
        source: networkSource,
        location: config.network.endpoint ?? configLocation,
        explanations: {
          passed: 'The E11 loopback health response matched the fixture protocol.',
          failed: 'The E11 loopback health response did not match the fixture protocol.',
          unknown: 'Protocol evidence is unavailable without a reachable endpoint.',
          skipped: 'The loopback protocol probe was not explicitly enabled.',
        },
        nextAction: 'Start the E11 health fixture and rerun with --probe-loopback.',
        observe: () => result(network.protocol, EVIDENCE.protocol),
      }),
    ],
    { now, profile: selectedProfile },
  );
}
