import { bindCapability, createCapabilityRegistry } from '@uppercut-labs/agent-native';
import catalog from '../public/catalog.json' with { type: 'json' };
import { catalogCapability } from './catalog-capability.js';

const catalogBinding = bindCapability(catalogCapability, {
  id: 'next-browser-catalog',
  targets: ['browser'],
  execute: () => ({ items: catalog }),
});

export const browserRegistry = createCapabilityRegistry([catalogCapability], [catalogBinding]);
