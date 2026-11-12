// Run with a new working directory and the URL where its public/ folder will be served.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { planPublication } from '@uppercut-labs/agent-native/publication';

const [root, siteUrl] = process.argv.slice(2);
if (!root || !siteUrl) throw Error('Usage: node build.mjs DIRECTORY SITE_URL');
const program = [
  {
    id: 'workshop-17',
    route: '/events/lantern/',
    title: 'Lantern workshop',
    opens: '10:30',
    public: true,
  },
  {
    id: 'draft-8',
    route: '/drafts/winter/',
    title: 'Winter preview',
    opens: '12:15',
    public: false,
  },
];
const input = {
  config: {
    enabled: true,
    siteUrl,
    title: 'Workshop calendar',
    description: 'Public workshop times.',
    full: true,
  },
  candidates: program.map((row) => ({
    id: row.id,
    revision: 'r1',
    route: row.route,
    visibility: row.public ? 'public' : 'draft',
    ...(row.public
      ? {
          title: row.title,
          markdown: `Doors open at ${row.opens}.`,
          structuredType: 'WebPage',
        }
      : {}),
  })),
};
const plan = await planPublication(input.config, input.candidates);
for (const entry of plan.manifest.entries.filter((entry) => entry.status === 'included')) {
  const item = program.find((row) => row.id === entry.sourceId);
  const data = plan.assets.find(
    (asset) => new URL(asset.path, siteUrl).href === entry.structuredData,
  );
  const page =
    '<!doctype html><html><head><title>' +
    item.title +
    '</title><link rel="canonical" href="' +
    entry.canonical +
    '"><script type="application/ld+json">' +
    data.content +
    '</script></head><body><main><h1>' +
    item.title +
    '</h1><p>Doors open at ' +
    item.opens +
    '.</p><a href="/llms.txt">Site guide</a></main></body></html>';
  const dir = path.join(root, 'public', item.route);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), page);
}
await mkdir(path.join(root, 'state'), { recursive: true });
await writeFile(path.join(root, 'site.json'), JSON.stringify(input, null, 2));
