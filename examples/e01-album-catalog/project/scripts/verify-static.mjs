import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const home = await readFile(path.join(root, 'index.html'), 'utf8');
const albums = await readFile(path.join(root, 'albums/index.html'), 'utf8');
const about = await readFile(path.join(root, 'about/index.html'), 'utf8');
const css = await readFile(path.join(root, 'site.css'), 'utf8');
const icon = await readFile(path.join(root, 'mark.svg'), 'utf8');

for (const html of [home, albums, about]) {
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/albums\//);
  assert.match(html, /href="\/about\//);
}
assert.match(home, /Records for the in-between hours/);
assert.match(albums, /Find an album by slug/);
assert.match(albums, /First Light/);
assert.match(albums, /Blue Hour/);
assert.match(albums, /data-catalog-revision/);
assert.match(albums, /data-sidecar-status/);
assert.match(about, /Existing pages stay in place/);
assert.match(css, /site-header/);
assert.match(icon, /<svg/);
await assert.rejects(readdir(path.join(root, 'server')));

const assetDirectory = path.join(root, '_astro');
const bundles = await readdir(assetDirectory);
const scripts = await Promise.all(
  bundles
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFile(path.join(assetDirectory, name), 'utf8')),
);
assert.ok(scripts.length > 0, 'Astro should emit the browser bootstrap bundle.');
const browserBundle = scripts.join('\n');
for (const forbidden of [
  '@modelcontextprotocol/',
  'createHttpHandler',
  'createOfficialMcp',
  'node:http',
  'server-sample-catalog',
]) {
  assert.equal(browserBundle.includes(forbidden), false, `browser bundle contains ${forbidden}`);
}

process.stdout.write(
  'Static Astro output retained home, albums, about, shared navigation, CSS, and SVG; browser bundle excludes HTTP/MCP server adapters.\n',
);
