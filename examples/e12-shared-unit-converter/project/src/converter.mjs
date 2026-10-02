import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';

const unitsInCentimeters = Object.freeze({ cm: 1, in: 2.54 });
const conversionInput = fromZod(
  z.object({
    value: z.number(),
    from: z.enum(['cm', 'in']),
    to: z.enum(['cm', 'in']),
  }),
);
const conversionOutput = fromZod(
  z.object({
    value: z.number(),
    unit: z.enum(['cm', 'in']),
  }),
);

export const convertDistanceCapability = defineCapability({
  identity: { namespace: 'example', name: 'distance.convert', majorVersion: 1 },
  description: 'Convert a finite distance between centimeters and inches.',
  input: conversionInput,
  output: conversionOutput,
  risk: 'read',
  access: { kind: 'public' },
});

/** @type {import('@uppercut-labs/agent-native').CapabilityBindingOptions<
 * z.output<typeof conversionInput>, z.output<typeof conversionOutput>
 * >['execute']} */
async function convertDistance(input) {
  const value = (input.value * unitsInCentimeters[input.from]) / unitsInCentimeters[input.to];
  return { value, unit: input.to };
}

export const localConversionBinding = bindCapability(convertDistanceCapability, {
  id: 'local-converter',
  targets: ['local'],
  execute: convertDistance,
});

const registry = createCapabilityRegistry([convertDistanceCapability], [localConversionBinding]);

/** @type {import('@uppercut-labs/agent-native').AuthorizationPort} */
const publicReadAuthorization = {
  authorize(request) {
    return request.access.kind === 'public' && request.risk === 'read';
  },
};

/** @param {unknown} input */
export function runConversion(input) {
  return executeCapability(registry, {
    identity: convertDistanceCapability.identity,
    runtime: 'local',
    input,
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  });
}
