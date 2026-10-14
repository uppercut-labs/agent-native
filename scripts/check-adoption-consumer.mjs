import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'agent-native-published-adoption-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Use npm run check:adoption');
try {
  const project = path.join(root, 'examples/e10-existing-functions-retrofit/project');
  await cp(project, temp, { recursive: true });
  const shared = JSON.parse(await readFile(path.join(project, 'shared-files.json'), 'utf8'));
  for (const [target, source] of Object.entries(shared)) {
    await mkdir(path.dirname(path.join(temp, target)), { recursive: true });
    await cp(path.join(root, source), path.join(temp, target));
  }
  const manifest = JSON.parse(await readFile(path.join(project, 'package.template.json'), 'utf8'));
  manifest.dependencies['@uppercut-labs/agent-native'] = '1.0.0';
  manifest.dependencies['@modelcontextprotocol/server'] = '2.3.0';
  manifest.dependencies['@modelcontextprotocol/client'] = '2.3.0';
  await writeFile(path.join(temp, 'package.json'), JSON.stringify(manifest));
  await cp(
    path.join(root, 'test/fixtures/adoption-network-smoke.mjs'),
    path.join(temp, 'verify.mjs'),
  );
  const options = { cwd: temp, stdio: 'inherit', timeout: 120000 };
  execFileSync(
    process.execPath,
    [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
    options,
  );
  execFileSync(process.execPath, [npmCli, 'test'], options);
  execFileSync(process.execPath, ['verify.mjs'], options);
} finally {
  await rm(temp, { recursive: true, force: true });
}
