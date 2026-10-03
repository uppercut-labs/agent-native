import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';

const input = fromZod(z.object({ theme: z.enum(['light', 'dark']) }));
const output = fromZod(z.object({ theme: z.enum(['light', 'dark']) }));

export function createThemePage(document) {
  const capability = defineCapability({
    identity: { namespace: 'example.browser', name: 'theme.set', majorVersion: 1 },
    description: 'Set the active page theme to light or dark.',
    input,
    output,
    risk: 'write',
    access: { kind: 'protected', scopes: ['theme:change'] },
  });
  // docs:start browser-theme-binding
  const binding = bindCapability(capability, {
    id: 'page-theme',
    targets: ['browser'],
    execute: async ({ theme }) => {
      document.documentElement.dataset.theme = theme;
      return { theme };
    },
  });
  // docs:end browser-theme-binding
  const registry = createCapabilityRegistry([capability], [binding]);
  const authorization = {
    authorize(request) {
      return (
        request.identity.namespace === 'example.browser' &&
        request.identity.name === 'theme.set' &&
        request.access.kind === 'protected' &&
        request.access.scopes.includes('theme:change')
      );
    },
  };
  return {
    registry,
    authorization,
    canExpose(definition) {
      return (
        definition.identity.namespace === 'example.browser' &&
        definition.identity.name === 'theme.set'
      );
    },
    async setTheme(theme) {
      return executeCapability(registry, {
        identity: capability.identity,
        runtime: 'browser',
        bindingId: binding.id,
        input: { theme },
        caller: { kind: 'anonymous' },
        authorization,
      });
    },
  };
}
