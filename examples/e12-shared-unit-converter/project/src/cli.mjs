import { convertDistance } from './converter.mjs';

const result = convertDistance({ value: 12, from: 'in', to: 'cm' });
process.stdout.write(`${result.value} ${result.unit}\n`);
