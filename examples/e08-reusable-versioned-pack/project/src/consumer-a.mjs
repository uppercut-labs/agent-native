import { bindCapability } from '@uppercut-labs/agent-native';
import { distanceConversion } from '@example/e08-distance-contracts';

const centimeters = Object.freeze({ cm: 1, in: 2.54 });

export const preciseBinding = bindCapability(distanceConversion, {
  id: 'precise-consumer',
  targets: ['local'],
  execute(input) {
    return {
      value: (input.value * centimeters[input.from]) / centimeters[input.to],
      unit: input.to,
      provider: 'precise-consumer',
    };
  },
});
