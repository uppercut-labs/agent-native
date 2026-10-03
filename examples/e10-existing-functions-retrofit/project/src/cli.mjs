import { readFile } from 'node:fs/promises';
import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';
import { publicReadAuthorization, registry } from './capability.mjs';

const code = await runCapabilityCli(
  process.argv.slice(2),
  {
    registry,
    authorization: publicReadAuthorization,
    caller: { kind: 'anonymous' },
    packageVersion: '0.0.0',
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
