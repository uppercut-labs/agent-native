import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
  executeCapability,
} from '@uppercut-labs/agent-native';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
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

// docs:start shared-converter-bindings
export const localConversionBinding = bindCapability(convertDistanceCapability, {
  id: 'local-converter',
  targets: ['local'],
  execute: convertDistance,
});
// docs:end shared-converter-bindings

export const browserConversionBinding = bindCapability(convertDistanceCapability, {
  id: 'browser-converter',
  targets: ['browser'],
  execute: convertDistance,
});

export const serverConversionBinding = bindCapability(convertDistanceCapability, {
  id: 'server-converter',
  targets: ['server'],
  execute: convertDistance,
});

export const registry = createCapabilityRegistry(
  [convertDistanceCapability],
  [localConversionBinding, browserConversionBinding, serverConversionBinding],
);

/** @type {import('@uppercut-labs/agent-native').AuthorizationPort} */
export const publicReadAuthorization = {
  authorize(request) {
    return request.access.kind === 'public' && request.risk === 'read';
  },
};

/** @param {unknown} input */
export function runConversion(input, runtime = 'local') {
  return executeCapability(registry, {
    identity: convertDistanceCapability.identity,
    runtime,
    input,
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  });
}

export const conversionHttpHandler = createHttpHandler(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});
