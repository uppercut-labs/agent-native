import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandSourceRegions } from './source-regions.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(repositoryRoot, 'docs');

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(filename)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(filename);
  }
  return files;
}

let snippets = 0;
let changed = 0;
for (const file of await markdownFiles(docsRoot)) {
  const original = await readFile(file, 'utf8');
  const lines = original.split('\n');
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = line.trim();
    if (marker.startsWith('{{source:')) {
      const expected = await expandSourceRegions(marker, file, repositoryRoot);
      output.push(`<!-- ${marker.slice(2, -2)} -->`, expected, '<!-- /source -->');
      snippets++;
      continue;
    }
    if (marker.startsWith('<!-- source:')) {
      const match = /^<!-- (source:[^<>]+) -->$/.exec(marker);
      if (!match) throw new Error(`${file}: invalid baked source marker: ${marker}`);
      const end = lines.indexOf('<!-- /source -->', index + 1);
      if (end < 0) throw new Error(`${file}: missing baked source end marker: ${marker}`);
      const expected = await expandSourceRegions(`{{${match[1]}}}`, file, repositoryRoot);
      output.push(marker, expected, '<!-- /source -->');
      index = end;
      snippets++;
      continue;
    }
    output.push(line);
  }
  const next = output.join('\n');
  if (next !== original) {
    await writeFile(file, next);
    changed++;
  }
}
console.log(`Synced ${snippets} source snippets; changed ${changed} Markdown files.`);
