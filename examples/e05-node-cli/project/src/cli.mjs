import { readFile } from 'node:fs/promises';
import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';
import { albumLookup, createAuthorization, registry } from './catalog.mjs';

const profiles = {};
if (process.env.UAN_PROFILE_DEMO_URL !== undefined) {
  profiles.demo = {
    baseUrl: process.env.UAN_PROFILE_DEMO_URL,
    token: process.env.UAN_PROFILE_DEMO_TOKEN ?? '',
  };
}
const code = await runCapabilityCli(
  process.argv.slice(2),
  {
    registry,
    authorization: createAuthorization(),
    caller: { kind: 'anonymous' },
    credentialProfiles: profiles,
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
