import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { writeFixtureFiles } from './fixture-files.mjs';
import { reference, reviewedReferenceRoutes } from './reference.mjs';

const run = promisify(execFile);

export async function preparePublication({
  appDir,
  siteUrl = process.env.SITE_URL || 'http://127.0.0.1:4173',
  showcase,
  approvedRoutes,
  assetDir = 'public',
  modelFile = 'generated/publication.json',
  enabled = process.env.READABILITY_PUBLICATION !== 'disabled',
}) {
  if (appDir instanceof URL) appDir = fileURLToPath(appDir);
  if (!Array.isArray(approvedRoutes)) throw new Error('Supply the reviewed showcase route list');
  const approved = new Set([...reviewedReferenceRoutes, ...approvedRoutes]);
  const sources = [
    ...reference(process.env.READABILITY_EDITION || 'updated', process.env.READABILITY_PROOF_CODE),
    ...(Array.isArray(showcase) ? showcase : [showcase]),
  ];
  const candidates = sources.map((source) => {
    const { id, revision, route, visibility } = source;
    if (visibility !== 'public' || !approved.has(route)) {
      return { id, revision, route, visibility: visibility === 'public' ? 'unknown' : visibility };
    }
    const { title, markdown, locale, category, structuredType, links } = source;
    return {
      id,
      revision,
      route,
      visibility,
      title,
      markdown,
      locale,
      category,
      structuredType,
      links,
    };
  });
  const config = {
    enabled,
    siteUrl,
    title: 'Port Almanac',
    description: 'Reviewed guides and public records.',
    full: true,
  };
  // CI installs a packed candidate in the example. In a source checkout use the built SDK.
  const installed = path.join(appDir, 'node_modules/@uppercut-labs/agent-native');
  const sdk = existsSync(installed)
    ? installed
    : fileURLToPath(new URL('../../../', import.meta.url));
  const pkg = JSON.parse(await readFile(path.join(sdk, 'package.json'), 'utf8'));
  const { planPublication } = await import(
    pathToFileURL(path.join(sdk, pkg.exports['./publication'].import))
  );
  // Human pages retain their approved source data when publication is disabled or withdrawn.
  const plan = await planPublication({ ...config, enabled: true }, candidates);
  const errors = plan.diagnostics.filter(({ severity }) => severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));

  const included = plan.manifest.entries.filter((entry) => entry.status === 'included');
  const includedIds = new Set(included.map((entry) => entry.sourceId));
  const pages = included.map((entry) => {
    const item = candidates.find(({ id }) => id === entry.sourceId);
    const sidecar = plan.assets.find(
      (asset) => new URL(asset.path, siteUrl.replace(/\/?$/, '/')).href === entry.structuredData,
    );
    const links = (item.links || []).flatMap((id) => {
      const target = candidates.find((candidate) => candidate.id === id && includedIds.has(id));
      return target ? [{ route: target.route, title: target.title }] : [];
    });
    return {
      id: item.id,
      route: item.route,
      title: item.title,
      markdown: item.markdown,
      locale: item.locale || 'en',
      canonical: entry.canonical,
      mirror: enabled ? entry.mirror : null,
      jsonld: enabled && sidecar ? JSON.parse(sidecar.content) : null,
      links,
    };
  });
  const projection = { siteUrl, publicationEnabled: enabled, pages };
  // Public fixture identity contains hashes only. Never serialize the build environment.
  const digest = (s) => createHash('sha256').update(s).digest('hex');
  const witness = {
    version: 1,
    edition: process.env.READABILITY_EDITION || 'updated',
    proofCodeHash: process.env.READABILITY_PROOF_CODE
      ? digest(process.env.READABILITY_PROOF_CODE)
      : null,
    projectionHash: digest(JSON.stringify(projection)),
  };
  await writeFixtureFiles({
    appDir,
    assetDir,
    modelFile,
    input: JSON.stringify({ config, candidates }),
    model: JSON.stringify(projection, null, 2) + '\n',
    witness: JSON.stringify(witness) + '\n',
    publish: async ({ manifest, out, state }) => {
      // Build owners review explicit routes above. Use the CLI's ownership / conflict checks for file writes.
      const cli = path.join(sdk, pkg.bin['agent-native-site']);
      const args = ['--manifest', manifest, '--out', out, '--state', state];
      async function command(name, ...extra) {
        try {
          const { stdout } = await run(process.execPath, [cli, name, ...args, ...extra]);
          return JSON.parse(stdout);
        } catch (error) {
          throw new Error(error.stdout || error.message, { cause: error });
        }
      }
      const preview = await command('preview');
      await command('apply', '--approve', preview.digest);
    },
  });
  return projection;
}
