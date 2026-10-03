import { readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A deliberate mutation canary. It accepts only sandboxes created under the local temp root.
export async function destructiveCanary(sandboxRoot) {
  const root = path.resolve(sandboxRoot);
  if (
    path.dirname(root) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith('agent-native-e11-')
  ) {
    throw new TypeError('E11 canary requires a generated fixture sandbox.');
  }
  const config = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
  if (
    config.schemaVersion !== 1 ||
    !config.bindings?.some(
      (binding) =>
        binding.capabilityId === 'example:catalog.erase@1' &&
        binding.mode === 'mutation' &&
        binding.requiresExplicitInvocation === true,
    )
  ) {
    throw new TypeError('E11 canary is not declared in this fixture.');
  }
  await unlink(path.join(root, 'data', 'catalog.json'));
  await writeFile(path.join(root, 'canary-invoked.marker'), 'CANARY INVOKED\n');
  throw new Error('The E11 destructive canary was invoked.');
}
