import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  DOCTOR_REPORT_JSON_SCHEMA,
  DOCTOR_REPORT_SCHEMA_VERSION,
  DoctorUsageError,
  inspectCapabilityRegistry,
  listAuthorizedCapabilities,
  runDoctor,
} from '@uppercut-labs/agent-native/doctor';
import * as z from 'zod';
import { fromZod } from '../dist/adapters/zod.js';
import { bindCapability, createCapabilityRegistry, defineCapability } from '../dist/index.js';

const port = fromZod(z.object({}));

function capability(name, risk = 'read', access = { kind: 'public' }) {
  return defineCapability({
    identity: { namespace: 'doctor.test', name, majorVersion: 1 },
    description: `Test ${name}.`,
    input: port,
    output: port,
    risk,
    access,
  });
}

function check(checkId, status, required = true) {
  return {
    checkId,
    target: 'fixture',
    required,
    severity: status === 'failed' ? 'error' : 'warning',
    evidence: { kind: 'configured', location: 'fixture.json' },
    explanations: {
      passed: 'The fixture is configured.',
      failed: 'The fixture is misconfigured.',
      unknown: 'Configuration evidence is unavailable.',
      skipped: 'The configuration check was skipped.',
    },
    nextAction: 'Review fixture.json.',
    observe: () => ({ status, evidenceRefs: ['FIXTURE.CONFIG'] }),
  };
}

test('doctor findings retain stable evidence fields and enforce exit semantics', async () => {
  const now = () => new Date('2026-01-02T03:04:05.000Z');
  const passed = await runDoctor([check('UAN-019.configured', 'passed')], { now });
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.schemaVersion, DOCTOR_REPORT_SCHEMA_VERSION);
  assert.deepEqual(passed.findings[0], {
    checkId: 'UAN-019.configured',
    target: 'fixture',
    status: 'passed',
    severity: 'warning',
    timestamp: '2026-01-02T03:04:05.000Z',
    required: true,
    evidence: {
      kind: 'configured',
      source: 'unspecified',
      location: 'fixture.json',
      references: ['FIXTURE.CONFIG'],
    },
    explanation: 'The fixture is configured.',
    nextAction: 'Review fixture.json.',
  });

  assert.equal((await runDoctor([check('UAN-019.failed', 'failed')])).exitCode, 1);
  assert.equal((await runDoctor([check('UAN-019.unknown', 'unknown')])).exitCode, 3);
  assert.equal((await runDoctor([check('UAN-019.skipped', 'skipped')])).exitCode, 3);
  assert.equal((await runDoctor([check('UAN-019.optional', 'unknown', false)])).exitCode, 0);
});

test('machine report follows its versioned JSON schema and rejects missing checkId', async () => {
  const validate = new Ajv2020({ strict: false }).compile(DOCTOR_REPORT_JSON_SCHEMA);
  const report = await runDoctor([check('UAN-019.configured', 'passed')]);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  const invalid = structuredClone(report);
  delete invalid.findings[0].checkId;
  assert.equal(validate(invalid), false);
  invalid.findings[0].checkId = 'UAN-019Xconfigured';
  assert.equal(validate(invalid), false);
  invalid.findings[0].checkId = 'UAN-019.configured';
  invalid.profile.selectedCheckIds[0] = 'invalid';
  assert.equal(validate(invalid), false);
});

test('profiles select checks and require named evidence without running omitted observers', async () => {
  let omittedCalls = 0;
  const checks = [
    check('UAN-019.configured', 'passed'),
    {
      ...check('UAN-019.reachable', 'unknown'),
      observe() {
        omittedCalls += 1;
        return { status: 'unknown' };
      },
    },
  ];
  const local = await runDoctor(checks, {
    profile: {
      id: 'local',
      selectedCheckIds: ['UAN-019.configured'],
      requiredCheckIds: ['UAN-019.configured'],
    },
  });
  assert.equal(local.exitCode, 0);
  assert.deepEqual(local.profile.requiredCheckIds, ['UAN-019.configured']);
  assert.deepEqual(
    local.findings.map(({ checkId }) => checkId),
    ['UAN-019.configured'],
  );
  assert.equal(omittedCalls, 0);
  const full = await runDoctor(checks, {
    profile: {
      id: 'full',
      selectedCheckIds: ['UAN-019.configured', 'UAN-019.reachable'],
      requiredCheckIds: ['UAN-019.configured', 'UAN-019.reachable'],
    },
  });
  assert.equal(full.exitCode, 3);
  assert.deepEqual(full.profile.selectedCheckIds, ['UAN-019.configured', 'UAN-019.reachable']);
  assert.equal(omittedCalls, 1);
  await assert.rejects(
    () =>
      runDoctor(checks, {
        profile: {
          id: 'invalid',
          selectedCheckIds: ['UAN-019.configured'],
          requiredCheckIds: ['UAN-019.reachable'],
        },
      }),
    DoctorUsageError,
  );
});

test('an unavailable observer becomes unknown without disclosing its exception', async () => {
  const unavailable = {
    ...check('UAN-019.unavailable', 'passed'),
    observe() {
      throw new Error('PRIVATE_DIAGNOSTIC_PAYLOAD');
    },
  };
  const report = await runDoctor([unavailable]);
  assert.equal(report.exitCode, 3);
  assert.equal(report.findings[0].status, 'unknown');
  assert.equal(JSON.stringify(report).includes('PRIVATE_DIAGNOSTIC_PAYLOAD'), false);
});

test('invalid and duplicate checks are usage errors with exit code 2', async () => {
  await assert.rejects(() => runDoctor([check('invalid', 'passed')]), DoctorUsageError);
  await assert.rejects(
    () => runDoctor([check('UAN-019.same', 'passed'), check('UAN-019.same', 'passed')]),
    (error) => error instanceof DoctorUsageError && error.exitCode === 2,
  );
});

test('registry inspect and authorized list never invoke capability handlers', async () => {
  const publicRead = capability('public');
  const protectedRead = capability('protected', 'read', {
    kind: 'protected',
    scopes: ['catalog:read'],
  });
  const destructive = capability('erase', 'destructive', {
    kind: 'protected',
    scopes: ['catalog:erase'],
  });
  const unbound = capability('unbound');
  const browserOnly = capability('browser-only');
  const serverRead = capability('server-read');
  let handlerCalls = 0;
  const definitions = [publicRead, protectedRead, destructive, unbound, browserOnly, serverRead];
  const bindings = [publicRead, protectedRead, destructive].map((definition) =>
    bindCapability(definition, {
      id: `binding-${definition.identity.name}`,
      targets: ['local'],
      execute: () => {
        handlerCalls += 1;
        return {};
      },
    }),
  );
  bindings.push(
    bindCapability(browserOnly, {
      id: 'binding-browser-only',
      targets: ['browser'],
      execute: () => {
        handlerCalls += 1;
        return {};
      },
    }),
    bindCapability(serverRead, {
      id: 'binding-server-read',
      targets: ['server'],
      execute: () => {
        handlerCalls += 1;
        return {};
      },
    }),
  );
  const registry = createCapabilityRegistry(definitions, bindings);

  const inspection = inspectCapabilityRegistry(registry);
  assert.equal(inspection.definitions.length, 6);
  assert.equal(inspection.bindings.length, 5);
  assert.equal(handlerCalls, 0);

  const publicList = await listAuthorizedCapabilities(registry, { surface: 'cli' });
  assert.deepEqual(
    publicList.map(({ id }) => id),
    ['doctor.test:public@1', 'doctor.test:server-read@1'],
  );
  const authorized = await listAuthorizedCapabilities(registry, {
    surface: 'cli',
    authorize: () => true,
  });
  assert.deepEqual(
    authorized.map(({ id }) => id),
    ['doctor.test:public@1', 'doctor.test:protected@1', 'doctor.test:server-read@1'],
  );
  const browserList = await listAuthorizedCapabilities(registry, { surface: 'browser' });
  assert.deepEqual(
    browserList.map(({ id }) => id),
    ['doctor.test:browser-only@1'],
  );
  const httpList = await listAuthorizedCapabilities(registry, { surface: 'http' });
  assert.deepEqual(
    httpList.map(({ id }) => id),
    ['doctor.test:server-read@1'],
  );
  assert.equal(
    publicList.some(({ id }) => id === 'doctor.test:unbound@1'),
    false,
  );
  assert.equal(handlerCalls, 0);
});
