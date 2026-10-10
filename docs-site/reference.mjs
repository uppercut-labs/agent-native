import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const optionDescriptions = {
  mode: ['local or remote', 'Required for invocation; remote needs a profile.'],
  profile: ['lowercase slug (1-32 characters)', 'Remote only.'],
  'binding-id': ['exact binding ID', 'Local only.'],
  'timeout-ms': ['integer 1-300000 (default 10000)', 'Remote request deadline.'],
  'input-json': ['JSON document or - for stdin', 'Cannot combine with field flags.'],
};

function exportedDeclaration(source, filename, name) {
  const declaration = source.match(
    new RegExp(`^export type ${name} = \\{[\\s\\S]*?^\\};`, 'm'),
  )?.[0];
  if (!declaration) throw new Error(`Missing exported configuration type ${filename}#${name}`);
  return declaration;
}

export function renderReference(manifest, cliSource, sources = {}) {
  const parser = cliSource.match(/function parseArguments\([\s\S]*?\nfunction cliNames\(/)?.[0];
  if (!parser?.includes("argument === '--help'") || !parser.includes("argument === '--version'")) {
    throw new Error('CLI parser shape changed; update the reference generator');
  }
  const expectedRules = [
    'let timeoutMs: number = 10_000',
    'parsed < 1 || parsed > 300_000',
    "value !== 'local' && value !== 'remote'",
    '/^[a-z][a-z0-9-]{0,31}$/.test(value)',
    'inputJson !== undefined && flags.size > 0',
    "mode === 'local' && profile !== undefined",
    "mode === 'remote' && bindingId !== undefined",
  ];
  if (expectedRules.some((rule) => !parser.includes(rule))) {
    throw new Error('CLI option rules changed; update the reference generator');
  }
  const cases = [...parser.matchAll(/case '([a-z][a-z-]*)':/g)].map((match) => match[1]);
  if (
    cases.length !== Object.keys(optionDescriptions).length ||
    cases.some((name) => !Object.hasOwn(optionDescriptions, name))
  ) {
    throw new Error('CLI parser options changed; update the reference generator');
  }
  const exportRows = Object.entries(manifest.exports).map(([subpath, targets]) => {
    if (typeof targets !== 'object' || targets === null || !targets.types || !targets.import) {
      throw new Error(`Missing typed import for package export ${subpath}`);
    }
    const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    return `| \`${specifier}\` | \`${targets.types}\` | \`${targets.import}\` |`;
  });
  const optionRows = cases.map((name) => {
    const [value, boundary] = optionDescriptions[name];
    return `| \`--${name}\` | ${value} | ${boundary} |`;
  });
  const reference = `# Generated package and CLI reference

This page is generated from [package.json](../package.json) and the
[CLI parser](https://github.com/uppercut-labs/agent-native/blob/main/src/cli.ts). Run \`node docs-site/reference.mjs\` after changing those
sources. \`npm run docs:check\` fails if this page drifts. Agent Native
\`${manifest.version}\` is a preview; verify registry availability before npm installation.

## Typed package entrypoints

| Import specifier | Type declaration | ESM implementation |
| --- | --- | --- |
${exportRows.join('\n')}

The package's optional peers are listed in [installation](installation.md). Import only
the subpath needed by the application. A package-level executable is not shipped.

## Application CLI arguments

The application calls \`runCapabilityCli(argv, options, streams)\`. One command or
canonical capability ID is positional. A command override or alias retains the
canonical identity and has no version fallback.

| Argument | Value and default | Boundary |
| --- | --- | --- |
${optionRows.join('\n')}
| \`--<field>\` | typed scalar from input schema | Complex fields use \`--input-json\`. |
| \`--help\` or \`-h\` | no value | Lists visible capabilities. |
| \`--version\` | no value | Displays the application's supplied package version. |

For a runnable instance, use Node.js 22 or newer, \`npm ci\`, and
\`npm run example:e10\` from the repository root. The exported E10 CLI runs
\`npm run search -- --query night --limit 1\` successfully. An empty query exits
2 with \`invalid-input\`; provide a nonempty query to retry. See
[CLI behavior](cli.md) and [E10 instructions](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/README.md).
`;
  if (!sources.http || !sources.mcp || !sources.doctor) return reference;
  const sections = [
    ['CLI', 'src/cli.ts', cliSource, ['CliCredentialProfile', 'CapabilityCliOptions']],
    ['HTTP', 'src/http.ts', sources.http, ['HttpAdapterOptions']],
    ['MCP', 'src/mcp.ts', sources.mcp, ['McpAdapterOptions']],
    ['Doctor', 'src/doctor.ts', sources.doctor, ['DoctorRunOptions']],
  ];
  return (
    reference +
    '\n## Typed adapter configuration\n\n' +
    'These exported declarations are copied from the checked TypeScript source at build time.\n' +
    'Framework mounts and security ownership are explained in the linked guides.\n' +
    sections
      .map(
        ([label, filename, source, names]) =>
          `\n### ${label}\n\n[View source](https://github.com/uppercut-labs/agent-native/blob/main/${filename})\n\n~~~ts\n${names
            .map((name) => exportedDeclaration(source, filename, name))
            .join('\n\n')}\n~~~\n`,
      )
      .join('')
  );
}

export async function currentReference() {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const [cliSource, http, mcp, doctor] = await Promise.all(
    ['cli.ts', 'http.ts', 'mcp.ts', 'doctor.ts'].map((name) =>
      readFile(path.join(repositoryRoot, 'src', name), 'utf8'),
    ),
  );
  return renderReference(manifest, cliSource, { http, mcp, doctor });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(path.join(repositoryRoot, 'docs', 'reference.md'), await currentReference());
}
