import { defineCapability } from '@uppercut-labs/agent-native/contracts';
import { defineCapabilityPack } from '@uppercut-labs/agent-native/composition';

const conversionInput = Object.freeze({
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.value !== 'number' ||
      !Number.isFinite(value.value) ||
      (value.from !== 'cm' && value.from !== 'in') ||
      (value.to !== 'cm' && value.to !== 'in')
    ) {
      throw new TypeError('invalid conversion input');
    }
    return { value: value.value, from: value.from, to: value.to };
  },
  toJSONSchema() {
    return {
      type: 'object',
      properties: {
        value: { type: 'number' },
        from: { enum: ['cm', 'in'] },
        to: { enum: ['cm', 'in'] },
      },
      required: ['value', 'from', 'to'],
      additionalProperties: false,
    };
  },
});

const conversionOutput = Object.freeze({
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.value !== 'number' ||
      !Number.isFinite(value.value) ||
      (value.unit !== 'cm' && value.unit !== 'in') ||
      typeof value.provider !== 'string'
    ) {
      throw new TypeError('invalid conversion output');
    }
    return { value: value.value, unit: value.unit, provider: value.provider };
  },
  toJSONSchema() {
    return {
      type: 'object',
      properties: {
        value: { type: 'number' },
        unit: { enum: ['cm', 'in'] },
        provider: { type: 'string' },
      },
      required: ['value', 'unit', 'provider'],
      additionalProperties: false,
    };
  },
});

export const distanceConversion = defineCapability({
  identity: {
    namespace: 'example.org.measurement',
    name: 'distance.convert',
    majorVersion: 1,
  },
  description: 'Convert centimeters and inches using a consumer-supplied implementation.',
  input: conversionInput,
  output: conversionOutput,
  risk: 'read',
  access: { kind: 'protected', scopes: ['distance:convert'] },
});

export const measurementPack = defineCapabilityPack({
  identity: { authority: 'example.org', namespace: 'measurement' },
  source: '@example/e08-distance-contracts@1.0.0',
  definitions: [distanceConversion],
});
