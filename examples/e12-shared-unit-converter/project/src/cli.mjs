import { readFile } from 'node:fs/promises';
import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';
import { convertDistanceCapability, publicReadAuthorization, registry } from './converter.mjs';

const code = await runCapabilityCli(
  process.argv.slice(2),
  {
    registry,
    authorization: publicReadAuthorization,
    caller: { kind: 'anonymous' },
  },
  {
    writeStdout(value) {
      process.stdout.write(value);
    },
    writeStderr(value) {
      process.stderr.write(value);
    },
    async readStdin() {
      return await readFile(0, 'utf8');
    },
  },
);
process.exitCode = code;
