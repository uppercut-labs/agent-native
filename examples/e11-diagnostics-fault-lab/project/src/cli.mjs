import { diagnoseFixture } from './doctor.mjs';
import { launchFixture, listScenarios } from './fixture.mjs';

function parseDoctorFlags(flags) {
  let repaired = false;
  let probeLoopback = false;
  let profile = 'full';
  let profileSeen = false;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--repaired' && !repaired) {
      repaired = true;
    } else if (flag === '--probe-loopback' && !probeLoopback) {
      probeLoopback = true;
    } else if (flag === '--profile' && !profileSeen) {
      profile = flags[index + 1];
      if (profile !== 'local' && profile !== 'full') return undefined;
      profileSeen = true;
      index += 1;
    } else {
      return undefined;
    }
  }
  return { repaired, probeLoopback, profile };
}

const [command, scenarioId, ...flags] = process.argv.slice(2);
if (command === undefined || command === '--list') {
  const scenarios = await listScenarios();
  process.stdout.write(`${JSON.stringify(scenarios, null, 2)}\n`);
} else if (command === 'doctor') {
  const options = parseDoctorFlags(flags);
  if (scenarioId === undefined || options === undefined) {
    process.stderr.write(
      'Usage: node src/cli.mjs doctor SCENARIO_ID [--repaired] [--profile local|full] [--probe-loopback]\n',
    );
    process.exitCode = 2;
  } else {
    const scenarios = await listScenarios();
    if (!scenarios.some((scenario) => scenario.id === scenarioId)) {
      process.stderr.write(`Unknown E11 scenario: ${scenarioId}\n`);
      process.exitCode = 2;
    } else {
      const fixture = await launchFixture(scenarioId, {
        variant: options.repaired ? 'repaired' : 'fault',
      });
      const report = await diagnoseFixture(fixture.sandboxRoot, {
        profile: options.profile,
        probeLoopback: options.probeLoopback,
      });
      process.stdout.write(`${JSON.stringify({ ...fixture, ...report }, null, 2)}\n`);
      process.exitCode = report.exitCode;
    }
  }
} else {
  if (scenarioId !== undefined && scenarioId !== '--repaired') {
    throw new TypeError('Usage: node src/cli.mjs [--list|SCENARIO_ID [--repaired]]');
  }
  const fixture = await launchFixture(command, {
    variant: scenarioId === '--repaired' ? 'repaired' : 'fault',
  });
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}
