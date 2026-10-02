import { defineCapability } from '@uppercut-labs/agent-native/contracts';
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
});

export function convertDistance(candidate) {
  const input = convertDistanceCapability.input.parse(candidate);
  const value = (input.value * unitsInCentimeters[input.from]) / unitsInCentimeters[input.to];
  return convertDistanceCapability.output.parse({ value, unit: input.to });
}
