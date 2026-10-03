import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readCatalog(sandboxRoot) {
  return JSON.parse(await readFile(path.join(sandboxRoot, 'data', 'catalog.json'), 'utf8'));
}
