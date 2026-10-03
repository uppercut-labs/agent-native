# Generated CLI

This slice exports a runner from the separate `@uppercut-labs/agent-native/cli` entrypoint and includes runnable installed application CLIs in E05/E12. It does not yet ship a package-level `bin` command or global `agent-native` executable. Applications provide
a capability registry, caller, authorization port, and stream adapter. The library does not
discover application capabilities or credentials implicitly.

```ts
import { runCapabilityCli } from '@uppercut-labs/agent-native/cli';

const status = await runCapabilityCli(process.argv.slice(2), {
  registry,
  caller: { kind: 'anonymous' },
  authorization,
  credentialProfiles,
}, {
  writeStdout: (value) => process.stdout.write(value),
  writeStderr: (value) => process.stderr.write(value),
  readStdin: async () => readStdin(),
});
process.exitCode = status;
```

The registry generates the application CLI help list and simple field flags from each input JSON Schema. String,
number, integer, boolean, and enum properties accept typed flags; nested objects and arrays require
`--input-json JSON`. Use `--input-json -` to read one JSON document from the provided stdin port.
Capability identity must match the complete `namespace:name@major` form. There is no fallback to a
different version or binding.

Every invocation names `--mode local` or `--mode remote`. Local mode uses the shared executor and
requires the configured authorization port; an optional `--binding-id` selects one exact local
binding. Remote mode requires both `--profile NAME` and a configured own-property credential entry.
The profile includes an HTTPS base URL and bearer token. HTTP is permitted only for localhost and
loopback addresses for local fixtures. The CLI rejects URL userinfo and does not print tokens.
Remote mode rejects `--binding-id`; runtime binding selection belongs to the remote host.

A remote `--timeout-ms` races the request against a deadline and also signals abort to cooperative
fetchers. A fetcher that ignores abort cannot hold the CLI past that timeout. Remote JSON is checked
against the selected capability output schema before it can be reported as success.

For invocations, stdout contains exactly one JSON envelope using `uan.cli-result/v1`; stderr carries
effective target and redacted failure diagnostics. Exit codes are 0 for success, 2 for invalid input,
3 for denied authorization, and 1 for other failures. Help and version commands are human-readable.
The CLI runner itself never spawns a shell. Applications that launch it should pass argv as an array
and disable shell interpretation.

See the installed E05 and E12 application examples for real local and loopback HTTP fixtures, positive output, timeout,
credential, malformed-input, and handler-failure paths. E05 uses Node's built-in HTTP server and
does not claim a Hono/MCP integration, deployment, or external credential provider.
