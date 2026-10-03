import {
  bindCapability,
  createCapabilityRegistry,
  defineCapability,
} from '@uppercut-labs/agent-native';
import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';

const input = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof value.name !== 'string'
    ) {
      throw new TypeError('name is required');
    }
    return { name: value.name };
  },
  toJSONSchema() {
    return {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    };
  },
};
const output = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof value.greeting !== 'string'
    ) {
      throw new TypeError('greeting is required');
    }
    return { greeting: value.greeting };
  },
  toJSONSchema() {
    return {
      type: 'object',
      properties: { greeting: { type: 'string' } },
      required: ['greeting'],
      additionalProperties: false,
    };
  },
};
const definition = defineCapability({
  identity: { namespace: 'smoke', name: 'greet', majorVersion: 1 },
  description: 'Return a greeting.',
  input,
  output,
  risk: 'read',
  access: { kind: 'public' },
  surfaces: { cli: { command: 'greet' } },
});
const binding = bindCapability(definition, {
  id: 'smoke-local',
  targets: ['local'],
  execute({ name }) {
    return { greeting: `Hello, ${name}!` };
  },
});
const code = await runCapabilityCli(
  process.argv.slice(2),
  {
    registry: createCapabilityRegistry([definition], [binding]),
    authorization: { authorize: () => true },
    caller: { kind: 'anonymous' },
  },
  {
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
  },
);
process.exitCode = code;
