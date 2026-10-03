import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const directivePattern =
  /^\{\{source:(examples\/[a-z0-9-]+\/project\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:[cm]?[jt]sx?|json))#([a-z][a-z0-9-]*)\}\}$/;

function sourceFence(source) {
  const longestTilde = Math.max(0, ...[...source.matchAll(/~+/g)].map(([run]) => run.length));
  return '~'.repeat(Math.max(3, longestTilde + 1));
}

export async function expandSourceRegions(markdown, pageFile, repositoryRoot) {
  const output = [];
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const directive = line.trim();
    if (directive.startsWith('<!-- source:')) {
      const marker = /^<!-- (source:[^<>]+) -->$/.exec(directive);
      if (!marker) throw new Error(`${pageFile}: invalid baked source marker: ${directive}`);
      const expected = await expandSourceRegions(`{{${marker[1]}}}`, pageFile, repositoryRoot);
      const end = lines.indexOf('<!-- /source -->', index + 1);
      if (end < 0) throw new Error(`${pageFile}: missing baked source end marker: ${directive}`);
      if (
        lines
          .slice(index + 1, end)
          .join('\n')
          .trimEnd() !== expected
      ) {
        throw new Error(`${pageFile}: baked source region drifted: ${directive}`);
      }
      output.push(expected);
      index = end;
      continue;
    }
    if (directive === '<!-- /source -->') {
      throw new Error(`${pageFile}: unexpected baked source end marker`);
    }
    if (!directive.startsWith('{{source:')) {
      output.push(line);
      continue;
    }
    const match = directivePattern.exec(directive);
    if (!match) throw new Error(`${pageFile}: invalid source region directive: ${directive}`);
    const [, relativeFile, region] = match;
    const sourceFile = path.join(repositoryRoot, ...relativeFile.split('/'));
    const projectRoot = path.join(repositoryRoot, ...relativeFile.split('/').slice(0, 3));
    let resolvedFile;
    let resolvedProject;
    let resolvedRepository;
    try {
      [resolvedFile, resolvedProject, resolvedRepository] = await Promise.all([
        realpath(sourceFile),
        realpath(projectRoot),
        realpath(repositoryRoot),
      ]);
    } catch {
      throw new Error(`${pageFile}: source region file does not exist: ${relativeFile}`);
    }
    if (
      !resolvedProject.startsWith(`${resolvedRepository}${path.sep}examples${path.sep}`) ||
      !resolvedFile.startsWith(`${resolvedProject}${path.sep}`) ||
      !(await stat(resolvedFile)).isFile()
    ) {
      throw new Error(`${pageFile}: source region must be a project file: ${relativeFile}`);
    }
    const sourceLines = (await readFile(resolvedFile, 'utf8')).split(/\r?\n/);
    const marker = (kind) => new RegExp(`^\\s*// docs:${kind} ${region}\\s*$`);
    const starts = sourceLines.flatMap((sourceLine, index) =>
      marker('start').test(sourceLine) ? [index] : [],
    );
    const ends = sourceLines.flatMap((sourceLine, index) =>
      marker('end').test(sourceLine) ? [index] : [],
    );
    if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0] + 1) {
      throw new Error(
        `${pageFile}: source region ${relativeFile}#${region} needs one ordered, nonempty marker pair`,
      );
    }
    const regionLines = sourceLines.slice(starts[0] + 1, ends[0]);
    const nonempty = regionLines.filter((sourceLine) => sourceLine.trim());
    if (!nonempty.length)
      throw new Error(`${pageFile}: source region ${relativeFile}#${region} is empty`);
    const indent = Math.min(...nonempty.map((sourceLine) => sourceLine.match(/^ */)[0].length));
    const code = regionLines
      .map((sourceLine) => sourceLine.slice(indent))
      .join('\n')
      .trimEnd();
    const fence = sourceFence(code);
    const language = relativeFile.endsWith('.json')
      ? 'json'
      : relativeFile.endsWith('ts')
        ? 'ts'
        : 'js';
    const sourceHref = `https://github.com/uppercut-labs/agent-native/blob/main/${relativeFile}#L${starts[0] + 2}`;
    output.push(`${fence}${language}\n${code}\n${fence}\n\n[View tested source](${sourceHref})`);
  }
  return output.join('\n');
}
