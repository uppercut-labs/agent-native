// The caller has opened the framework's showcase in a fresh browser context.
export async function verifyInteraction(framework, page, origin) {
  const base = new URL(origin);
  const stop = framework === 'react-router';
  if (!stop && framework !== 'sveltekit') throw new Error('Unknown loader showcase');
  const path = stop ? '/lines/river/stops/quay' : '/events/lanterns';
  if (new URL(page.url()).href !== new URL(path, base).href) {
    throw new Error('Open the canonical showcase before testing interaction');
  }
  const initial = stop ? 'Save stop' : 'Save workshop';
  const saved = stop ? 'Stop saved' : 'Saved to schedule';
  await page.getByRole('button', { name: initial, exact: true }).click();
  await page.getByRole('button', { name: saved, exact: true }).waitFor();
}
