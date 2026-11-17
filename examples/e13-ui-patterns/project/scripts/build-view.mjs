// Bundles src/view.mjs (React 19 production build, official App bridge, Agent Native UI) and
// inlines it into one self-contained MCP App resource per pattern: dist/<pattern>.html.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizer } from 'acorn';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
await mkdir(outDir, { recursive: true });
const bundle = await build({
  entryPoints: [path.join(root, 'src/view.mjs')],
  bundle: true,
  minify: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});
/**
 * Minified code contains comparisons such as `a<t src=n.src`, which the MCP App resource scan
 * (deliberately strict) reads as HTML tags. Insert a space after each `<` operator token that is
 * directly followed by a letter. Only whitespace between tokens changes; strings, regular
 * expressions and template text stay byte-identical.
 */
function spaceLessThanOperators(code) {
  const cuts = [];
  for (const token of tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' })) {
    const text = code.slice(token.start, token.end);
    if (
      token.type.binop !== undefined &&
      text.startsWith('<') &&
      /[A-Za-z]/.test(code[token.end] ?? '')
    )
      cuts.push(token.end);
  }
  let out = '';
  let last = 0;
  for (const cut of cuts) {
    out += `${code.slice(last, cut)} `;
    last = cut;
  }
  return out + code.slice(last);
}
const script = spaceLessThanOperators(bundle.outputFiles[0].text).replace(
  /<\/script/gi,
  '<\\/script',
);
const template = await readFile(path.join(root, 'ui/index.html'), 'utf8');
const marker = '<script type="module" src="./view.js"></script>';
if (template.split(marker).length !== 2) throw new Error('Template needs exactly one view marker.');
for (const pattern of ['review', 'explore', 'media']) {
  const html = template
    .replace('__PATTERN__', pattern)
    .replace(marker, () => `<script type="module">\n${script}\n</script>`);
  await writeFile(path.join(outDir, `${pattern}.html`), html);
}
console.log(
  `Built three MCP App resources (${Math.round(Buffer.byteLength(script) / 1024)} KiB script each).`,
);
