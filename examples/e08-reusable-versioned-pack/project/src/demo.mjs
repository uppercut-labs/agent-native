import {
  composeCapabilityPacks,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { catalogPack } from '@example/e08-album-contracts';
import { legacyBinding } from './consumer-a.mjs';

const composition = composeCapabilityPacks([
  {
    pack: catalogPack,
    source: 'src/demo.mjs:consumer-import',
    aliasPolicy: {
      kind: 'explicit',
      aliases: [{ name: 'album-v1', capabilityId: 'example.org.catalog:album.lookup@1' }],
    },
  },
]);
const selected = composition.resolve('album-v1');
if (selected === undefined) throw new Error('v1 alias is not configured');
const registry = createCapabilityRegistry(composition.definitions, [legacyBinding]);
const result = await executeCapability(registry, {
  identity: selected.identity,
  runtime: 'local',
  input: { slug: 'kind-of-blue' },
  caller: { kind: 'anonymous' },
  authorization: { authorize: () => true },
});

process.stdout.write(`${JSON.stringify(result)}\n`);
