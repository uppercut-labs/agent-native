import assert from 'node:assert/strict';

export async function verifyInteraction(framework, page, origin, edition = 'updated') {
  if (framework === 'react-vite') {
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await page.getByText('Playback queue: Night Ferry', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Field guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Harbor field guide' }).waitFor();
    await page.getByRole('link', { name: 'Meridian crossing' }).click();
    await page
      .getByText(
        `The Meridian crossing departs from ${edition === 'original' ? 'Pier Four' : 'Pier Seven'} at 08:15.`,
      )
      .waitFor();
  } else if (framework === 'vue-vite') {
    await page.getByRole('link', { name: 'Parts catalog', exact: true }).click();
    await page.getByLabel('Filter parts').fill('no-match');
    await page.getByText('No matching parts', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('q'), 'no-match');
    await page.getByLabel('Filter parts').fill('brass');
    await page.getByRole('link', { name: 'Brass coupler' }).click();
    await page.getByRole('heading', { name: 'Brass coupler' }).waitFor();
    assert.equal(
      await page.locator('link[rel=canonical]').getAttribute('href'),
      new URL('/parts/brass-coupler', origin).href,
    );
  } else if (framework === 'astro') {
    const response = page.waitForResponse(
      (reply) => new URL(reply.url()).pathname === '/advisories/tide-window',
    );
    await page.getByRole('link', { name: 'View the tide advisory' }).click();
    assert.match((await response).headers()['cache-control'], /no-store/);
    await page.getByRole('heading', { name: 'Tide window advisory' }).waitFor();
    await page
      .getByText('The east breakwater walkway opens at 10:20 after the morning tide.')
      .waitFor();
  } else if (framework === 'next') {
    await page
      .getByText('Field recording requires the Signal Basics module and a portable recorder.')
      .waitFor();
    const response = page.waitForResponse(
      (reply) => new URL(reply.url()).pathname === '/lessons/studio-lab',
    );
    await page.getByRole('link', { name: 'Open your studio lab' }).click();
    assert.equal((await response).status(), 401);
    await page.getByText('Sign in to your studio account.').waitFor();
  }
}
