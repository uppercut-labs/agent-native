import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seen = new Set();
async function visit(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const code = await readFile(resolve(root, path), 'utf8');
  assert(
    !/\b(?:window|document|process|Buffer)\s*[.(]/.test(code),
    `Platform global in portable source ${path}`,
  );
  for (const match of code.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    assert(specifier.startsWith('.'), `Unexpected dependency ${specifier} in ${path}`);
    const next = posix.normalize(posix.join(posix.dirname(path), specifier));
    assert(!/ui-(react|dom|styles)/.test(next), `Renderer pulled into portable graph: ${next}`);
    await visit(next);
  }
}
await visit('dist/ui.js');
await visit('dist/ui-patterns.js');
await visit('dist/ui-mcp.js');
await visit('dist/ui-presentation.js');
const outputs = (await readdir(resolve(root, 'dist'))).filter((p) => p.endsWith('.js'));
for (const file of outputs) {
  const text = await readFile(resolve(root, 'dist', file), 'utf8');
  assert(
    !/\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=/.test(text),
    `Dynamic code/HTML in ${file}`,
  );
}
console.log(
  `Portable import graph checked (${seen.size} modules); no external packages, DOM globals, or renderer imports. Renderer outputs contain no eval/HTML injection.`,
);
