import { catalogPack } from '@example/e08-album-contracts';
import {
  composeCapabilityPacks,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { localizedBinding } from './consumer-b.mjs';

const composition = composeCapabilityPacks([
  { pack: catalogPack, source: 'src/demo-b.mjs:consumer-import', aliasPolicy: { kind: 'none' } },
]);
// docs:start select-v2-major
const selected = composition.select({
  namespace: 'example.org.catalog',
  name: 'album.lookup',
  majorVersion: 2,
});
if (selected === undefined) throw new Error('v2 contract is not installed');
// docs:end select-v2-major
const registry = createCapabilityRegistry(composition.definitions, [localizedBinding]);
const result = await executeCapability(registry, {
  identity: selected.identity,
  runtime: 'local',
  input: { slug: 'kind-of-blue', locale: 'fr-FR' },
  caller: { kind: 'anonymous' },
  authorization: { authorize: () => true },
});

process.stdout.write(`${JSON.stringify(result)}\n`);
