import { distanceConversion } from '@example/e08-distance-contracts';
import { bindCapability } from '@uppercut-labs/agent-native';

export const fixtureBinding = bindCapability(distanceConversion, {
  id: 'fixture-consumer',
  targets: ['local'],
  execute(input) {
    const centimeters = input.from === 'cm' ? input.value : input.value * 2.54;
    return {
      value: input.to === 'cm' ? centimeters : centimeters / 2.54,
      unit: input.to,
      provider: 'fixture-consumer',
    };
  },
});
