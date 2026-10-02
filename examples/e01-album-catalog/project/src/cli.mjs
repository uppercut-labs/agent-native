import { runAlbumLookup } from './catalog.mjs';

const result = await runAlbumLookup({ slug: 'first-light' });
if (result.kind !== 'success') {
  throw new Error(`Album lookup failed: ${result.reason}`);
}
process.stdout.write(`${JSON.stringify(result.value)}\n`);
