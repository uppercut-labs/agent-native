import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const expectedIds = Array.from(
  { length: 12 },
  (_, index) => `E${String(index + 1).padStart(2, '0')}`,
);

export async function validateCoverage(repositoryRoot, suppliedManifest) {
  const failures = [];
  const root = await realpath(repositoryRoot);
  const manifest =
    suppliedManifest ??
    JSON.parse(await readFile(path.join(root, 'docs-site', 'coverage.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.examples)) {
    return ['docs-site/coverage.json: expected schemaVersion 1 and an examples array'];
  }

  async function checkedFile(relative, label) {
    if (
      typeof relative !== 'string' ||
      !/^[A-Za-z0-9._/-]+$/.test(relative) ||
      path.posix.normalize(relative) !== relative ||
      relative.split('/').includes('..') ||
      relative.startsWith('/')
    ) {
      failures.push(`${label}: invalid repository path ${String(relative)}`);
      return null;
    }
    try {
      const resolved = await realpath(path.join(root, ...relative.split('/')));
      if (!resolved.startsWith(`${root}${path.sep}`) || !(await stat(resolved)).isFile()) {
        failures.push(`${label}: path is not a repository file: ${relative}`);
        return null;
      }
      return await readFile(resolved, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      failures.push(`${label}: missing file ${relative}`);
      return null;
    }
  }

  const packageJson = JSON.parse((await checkedFile('package.json', 'package')) ?? '{}');
  const scripts = packageJson.scripts ?? {};
  const checkCommand = scripts.check ?? '';
  if (!/(?:^|\s)npm run docs:check(?:\s|$)/.test(checkCommand)) {
    failures.push('package.json: check must invoke docs:check');
  }
  const workflow = await checkedFile(manifest.ciWorkflow, 'CI workflow');
  if (workflow !== null && !/^\s*- run: npm run check\s*$/m.test(workflow)) {
    failures.push(`${manifest.ciWorkflow}: CI must run npm run check`);
  }

  const seenIds = new Set();
  const seenProjects = new Set();
  for (const entry of manifest.examples) {
    if (!entry || typeof entry !== 'object') {
      failures.push('coverage manifest: each example must be an object');
      continue;
    }
    const {
      id,
      project,
      source,
      readme,
      guide,
      evidence,
      script,
      negative,
      feature,
      requirements,
    } = entry;
    if (!expectedIds.includes(id) || seenIds.has(id)) {
      failures.push(`coverage manifest: unexpected or duplicate example ID ${String(id)}`);
      continue;
    }
    seenIds.add(id);
    const projectMatch = new RegExp(`^examples/${id.toLowerCase()}-[a-z0-9-]+/project$`);
    if (!projectMatch.test(project) || seenProjects.has(project)) {
      failures.push(`${id}: invalid or duplicate project ${String(project)}`);
      continue;
    }
    seenProjects.add(project);
    if (typeof feature !== 'string' || !feature.trim()) failures.push(`${id}: missing feature`);
    if (
      !Array.isArray(requirements) ||
      !requirements.length ||
      requirements.some((item) => !/^R\d{2}$/.test(item))
    ) {
      failures.push(`${id}: invalid requirement coverage`);
    }
    if (script !== `example:${id.toLowerCase()}`) failures.push(`${id}: invalid example script`);
    const packageScript = scripts[script];
    const exampleSlug = project.split('/')[1];
    if (
      typeof packageScript !== 'string' ||
      !packageScript.includes(`node scripts/check-example.mjs ${exampleSlug}`)
    ) {
      failures.push(`${id}: package.json script must export ${exampleSlug}`);
    }
    if (!new RegExp(`(?:^|\\s)npm run ${script}(?:\\s|$)`).test(checkCommand)) {
      failures.push(`${id}: package.json check must invoke ${script}`);
    }
    if (typeof source !== 'string' || !source.startsWith(`${project}/`)) {
      failures.push(`${id}: source must be inside its runnable project`);
    } else await checkedFile(source, `${id} source`);
    if (typeof readme !== 'string' || !readme.startsWith(`examples/${exampleSlug}/`)) {
      failures.push(`${id}: instructions must be inside its example`);
    } else await checkedFile(readme, `${id} instructions`);
    if (typeof guide !== 'string' || !/^docs\/(?!evidence\/)[a-z0-9-]+\.md$/.test(guide)) {
      failures.push(`${id}: invalid public guide`);
    } else {
      const guideText = await checkedFile(guide, `${id} guide`);
      if (guideText !== null) {
        if (!guideText.includes(id) && !guideText.includes(exampleSlug)) {
          failures.push(`${id}: guide does not reference its example`);
        }
        if (typeof source === 'string' && !guideText.includes(`{{source:${source}#`)) {
          failures.push(`${id}: guide has no source-backed snippet from ${source}`);
        }
      }
    }
    if (
      typeof evidence !== 'string' ||
      !/^docs\/evidence\/UAN-[0-9]{3}-[a-z0-9-]+\.md$/.test(evidence)
    ) {
      failures.push(`${id}: invalid public evidence link`);
    } else await checkedFile(evidence, `${id} evidence`);
    if (
      !negative ||
      typeof negative.test !== 'string' ||
      !negative.test.startsWith(`${project}/test/`) ||
      typeof negative.probe !== 'string' ||
      !negative.probe.trim() ||
      typeof negative.expected !== 'string' ||
      !negative.expected.trim()
    ) {
      failures.push(`${id}: incomplete expected failure path`);
    } else {
      const testText = await checkedFile(negative.test, `${id} negative test`);
      if (testText !== null && !testText.includes(negative.probe)) {
        failures.push(`${id}: negative probe is missing from ${negative.test}`);
      }
    }
  }

  for (const id of expectedIds)
    if (!seenIds.has(id)) failures.push(`coverage manifest: missing ${id}`);
  const projectDirectories = (await readdir(path.join(root, 'examples'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^e\d\d-/.test(entry.name))
    .map((entry) => `examples/${entry.name}/project`);
  for (const project of projectDirectories) {
    if (!seenProjects.has(project)) failures.push(`coverage manifest: missing project ${project}`);
  }
  return failures;
}
