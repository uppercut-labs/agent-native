import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { JSON_SCHEMA, load } from 'js-yaml';

import { agentResources } from './agent-resource-paths.mjs';
export { agentResources } from './agent-resource-paths.mjs';

export async function validateAgentResources(repositoryRoot) {
  const root = await realpath(repositoryRoot);
  const failures = [];
  const texts = new Map();
  for (const [source] of agentResources) {
    try {
      const file = await realpath(path.join(root, source));
      if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) {
        failures.push(`${source}: resource escapes repository`);
        continue;
      }
      const text = await readFile(file, 'utf8');
      texts.set(source, text);
      if (!text.trim()) failures.push(`${source}: empty resource`);
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = match[1];
        let target;
        if (
          /^https:\/\/github\.com\/uppercut-labs\/agent-native\/(?:blob|tree)\/main\//.test(href)
        ) {
          target = path.join(
            root,
            href
              .replace(
                /^https:\/\/github\.com\/uppercut-labs\/agent-native\/(?:blob|tree)\/main\//,
                '',
              )
              .split('#')[0],
          );
        } else if (/^(?:https?:|#)/.test(href)) continue;
        else target = path.resolve(path.dirname(file), href.split('#')[0]);
        try {
          const resolved = await realpath(target);
          if (!resolved.startsWith(root + path.sep)) throw new Error('escape');
        } catch {
          failures.push(`${source}: broken or escaping reference ${href}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      failures.push(`${source}: missing resource`);
    }
  }
  const skill = texts.get('skill/agent-native/SKILL.md') ?? '';
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1];
  let metadata;
  try {
    metadata = frontmatter && load(frontmatter, { schema: JSON_SCHEMA });
  } catch {
    failures.push('SKILL.md: invalid YAML frontmatter');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    failures.push('SKILL.md: YAML frontmatter must be a mapping');
  }
  if (metadata?.name !== 'agent-native') {
    failures.push('SKILL.md: YAML name must be agent-native');
  }
  if (typeof metadata?.description !== 'string' || metadata.description.trim().length < 21) {
    failures.push('SKILL.md: YAML description must explain the integration trigger');
  }
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  for (const file of ['skill/agent-native/SKILL.md', 'agent/agent-prompt.md']) {
    if (!texts.get(file)?.includes(version)) failures.push(`${file}: package version is stale`);
  }
  return failures;
}
