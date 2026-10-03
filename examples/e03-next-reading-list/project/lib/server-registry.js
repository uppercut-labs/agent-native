import 'server-only';

import { bindCapability, createCapabilityRegistry } from '@uppercut-labs/agent-native';
import catalog from '../public/catalog.json' with { type: 'json' };
import { catalogCapability } from './catalog-capability.js';

const catalogBinding = bindCapability(catalogCapability, {
  id: 'next-server-catalog',
  targets: ['server'],
  execute: () => ({ items: catalog }),
});

export const serverRegistry = createCapabilityRegistry([catalogCapability], [catalogBinding]);
