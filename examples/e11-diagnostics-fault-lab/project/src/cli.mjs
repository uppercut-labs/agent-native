import { launchFixture, listScenarios } from './fixture.mjs';

const [scenarioId, variantFlag] = process.argv.slice(2);
if (scenarioId === undefined || scenarioId === '--list') {
  const scenarios = await listScenarios();
  process.stdout.write(`${JSON.stringify(scenarios, null, 2)}\n`);
} else {
  if (variantFlag !== undefined && variantFlag !== '--repaired') {
    throw new TypeError('Usage: node src/cli.mjs [--list|SCENARIO_ID [--repaired]]');
  }
  const fixture = await launchFixture(scenarioId, {
    variant: variantFlag === '--repaired' ? 'repaired' : 'fault',
  });
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}
