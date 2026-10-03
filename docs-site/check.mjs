import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCoverage } from './coverage-check.mjs';
import { currentReference } from './reference.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const repositoryRoot = path.resolve(root, '..', '..');

async function collectHtml(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtml(file)));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(file);
  }
  return files;
}

const htmlFiles = await collectHtml(root);
const failures = [];
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  if (!html.includes('<nav id="site-nav"') || !html.includes('id="site-search"')) {
    failures.push(`${file}: missing navigation or search`);
  }
  for (const match of html.matchAll(/<(?:a|link|script|img)\b[^>]*\b(?:href|src)="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/^(https?:|mailto:|#)/i.test(href)) continue;
    const [pathname, fragment] = href.split('#', 2);
    const destination = path.resolve(path.dirname(file), decodeURIComponent(pathname));
    const target =
      destination.endsWith(path.sep) || !path.extname(destination)
        ? path.join(destination, 'index.html')
        : destination;
    if (!existsSync(target)) failures.push(`${file}: broken generated link ${href}`);
    else if (fragment && target.endsWith('.html')) {
      const targetHtml = await readFile(target, 'utf8');
      if (!targetHtml.includes(`id="${decodeURIComponent(fragment)}"`)) {
        failures.push(`${file}: missing generated heading ${href}`);
      }
    }
  }
}

const index = JSON.parse(await readFile(path.join(root, 'search-index.json'), 'utf8'));
if (index.length !== htmlFiles.length - 1) {
  failures.push(`Search index has ${index.length} records for ${htmlFiles.length - 1} guide pages`);
}
failures.push(...(await validateCoverage(repositoryRoot)));
const actualReference = await readFile(path.join(repositoryRoot, 'docs', 'reference.md'), 'utf8');
if (actualReference !== (await currentReference())) {
  failures.push('docs/reference.md: generated API/CLI reference is stale');
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(
  `Validated ${htmlFiles.length} generated HTML pages, ${index.length} search entries, and 12 example coverage records`,
);
