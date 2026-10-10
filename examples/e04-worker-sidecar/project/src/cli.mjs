import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';
import { registry } from './catalog.mjs';

// The same shared E01 contract and registry the Worker serves. The CLI runs in Node and calls the
// sidecar's generated HTTP route; it is not part of the Worker bundle.
const profiles = {};
if (process.env.UAN_PROFILE_SIDECAR_URL !== undefined) {
  profiles.sidecar = {
    baseUrl: process.env.UAN_PROFILE_SIDECAR_URL,
    token: process.env.UAN_PROFILE_SIDECAR_TOKEN ?? '',
  };
}
const code = await runCapabilityCli(
  process.argv.slice(2),
  {
    registry,
    authorization: { authorize: (request) => request.access.kind === 'public' },
    caller: { kind: 'anonymous' },
    credentialProfiles: profiles,
  },
  {
    writeStdout(value) {
      process.stdout.write(value);
    },
    writeStderr(value) {
      process.stderr.write(value);
    },
    async readStdin() {
      return '';
    },
  },
);
process.exitCode = code;
