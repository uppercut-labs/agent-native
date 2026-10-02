import { runConversion } from './converter.mjs';

const result = await runConversion({ value: 12, from: 'in', to: 'cm' });
if (result.kind !== 'success') {
  throw new Error(`Conversion failed: ${result.reason}`);
}
process.stdout.write(`${result.value.value} ${result.value.unit}\n`);
