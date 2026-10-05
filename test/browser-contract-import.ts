import { defineCapability } from '../src/core/contracts.js';
import type { SchemaPort } from '../src/core/schema.js';
import type { OpenHarnessSessionRequest, ProgrammaticHarnessAdapter } from '../src/harness.js';

const stringSchema: SchemaPort<string> = {
  parse(input: unknown): string {
    if (typeof input !== 'string') {
      throw new TypeError('Expected string');
    }
    return input;
  },
  toJSONSchema(): Readonly<Record<string, unknown>> {
    return { type: 'string' };
  },
};

export const browserContractImport = defineCapability({
  identity: { namespace: 'example', name: 'lookup', majorVersion: 1 },
  description: 'Look up an item by its identifier.',
  input: stringSchema,
  output: stringSchema,
  risk: 'read',
  access: { kind: 'public' },
});

export async function browserHarnessImport(adapter: ProgrammaticHarnessAdapter): Promise<void> {
  const session = await adapter.openSession({ target: 'local', workspace: '/workspace' });
  await adapter.resumeSession({ session, target: 'local', workspace: '/workspace' });
  for await (const event of adapter.runTurn({ session, prompt: 'A caller-owned instruction' })) {
    if (event.type === 'failed') throw new Error(event.reason);
  }
  await adapter.closeSession({ session });
}

// @ts-expect-error -- local sessions require an explicit workspace.
export const missingHarnessWorkspace: OpenHarnessSessionRequest = { target: 'local' };
export const cloudHarnessWorkspace: OpenHarnessSessionRequest = {
  target: 'cloud',
  // @ts-expect-error -- remote repository details belong in provider configuration.
  workspace: '/tmp',
};
