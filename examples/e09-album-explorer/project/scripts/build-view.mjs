import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/view.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(outDir, 'view.js'),
  legalComments: 'none',
});
const template = await readFile(path.join(root, 'ui/index.html'), 'utf8');
const script = await readFile(path.join(outDir, 'view.js'), 'utf8');
if (
  /(?:<(?:script|iframe|link)\b[^>]*(?:src|href)\s*=\s*["']https?:|@import|url\(\s*["']?https?:)/i.test(
    template,
  )
) {
  throw new Error('MCP App resource must have no external script or origin.');
}
const html = template.replace(
  '<script type="module" src="./view.js"></script>',
  `<script type="module">\n${script}\n</script>`,
);
await writeFile(path.join(outDir, 'mcp-app.html'), html);
console.log('Built isolated MCP App resource with inline JavaScript.');
