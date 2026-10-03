import {
  composeCapabilityPacks,
  createCapabilityRegistry,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { distanceConversion, measurementPack } from '@example/e08-distance-contracts';
import { preciseBinding } from './consumer-a.mjs';

const composition = composeCapabilityPacks([
  {
    pack: measurementPack,
    source: 'src/demo.mjs:consumer-import',
    aliasPolicy: {
      kind: 'explicit',
      aliases: [
        {
          name: 'distance',
          capabilityId: 'example.org.measurement:distance.convert@1',
        },
      ],
    },
  },
]);
const registry = createCapabilityRegistry(composition.definitions, [preciseBinding]);
const result = await executeCapability(registry, {
  identity: distanceConversion.identity,
  runtime: 'local',
  input: { value: 12, from: 'in', to: 'cm' },
  caller: { kind: 'authenticated', subject: 'demo-user', scopes: ['distance:convert'] },
  authorization: {
    authorize: (request) =>
      request.caller.kind === 'authenticated' &&
      request.access.kind === 'protected' &&
      request.access.scopes.every((scope) => request.caller.scopes.includes(scope)),
  },
});

process.stdout.write(`${JSON.stringify(result)}\n`);
