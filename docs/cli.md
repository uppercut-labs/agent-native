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

The help list filters to public reads by default, and a selected hidden or unknown identity gets the same generic unavailable message. Applications may provide an async `canDiscover` callback for protected help metadata and `surfaceExposure: { cli: { destructive: ['account:delete@1'] } }` for exact destructive exposure. A destructive entry still needs the app's `canDiscover` approval; direct execution is independently checked by the shared executor.

The registry generates the application CLI help list and simple field flags from each input JSON Schema. String,
number, integer, boolean, and enum properties accept typed flags; nested objects and arrays require
`--input-json JSON`. Use `--input-json -` to read one JSON document from the provided stdin port.
Capability identity must match the complete `namespace:name@major` form. There is no fallback to a
different version or binding.

Definitions may replace that invocation name with an established command and explicit aliases:

E10 binds its existing command names in the same tested definition:

<!-- source:examples/e10-existing-functions-retrofit/project/src/capability.mjs#cli-command-override -->
~~~js
cli: {
  command: 'content-search',
  aliases: ['search'],
},
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/src/capability.mjs#L39)
<!-- /source -->

Commands and aliases are lowercase slugs and must be unique across the registry. They resolve to
the same canonical capability identity used for execution and result envelopes; an override does
not change the contract identity.

Every invocation names `--mode local` or `--mode remote`. Local mode uses the shared executor and
requires the configured authorization port; an optional `--binding-id` selects one exact local
binding. Remote mode requires both `--profile NAME` and a configured own-property credential entry.
The profile includes an HTTPS base URL and bearer token. HTTP is permitted only for localhost and
loopback addresses for local fixtures. The CLI rejects URL userinfo and does not print tokens.
Remote mode rejects `--binding-id`; runtime binding selection belongs to the remote host.

A remote `--timeout-ms` races the request against a deadline and also signals abort to cooperative
fetchers. A fetcher that ignores abort cannot hold the CLI past that timeout. The generated remote
HTTP surface exposes public reads only; protected writes are rejected before any network request.
Local mode does not apply `--timeout-ms` to a binding. Remote JSON is checked against the selected
capability output schema before it can be reported as success.

For invocations, stdout contains exactly one JSON envelope using `uan.cli-result/v1`; stderr carries
effective target and redacted failure diagnostics. Exit codes are 0 for success, 2 for invalid input,
3 for denied authorization, and 1 for other failures. Help and version commands are human-readable.
The CLI runner itself never spawns a shell. Applications that launch it should pass argv as an array
and disable shell interpretation.

See the installed E05 and E12 application examples for local and loopback HTTP fixtures, positive
output, timeout, credential, malformed-input, and handler-failure paths. E05 mounts the generated
HTTP and MCP handlers into one pinned Node/Hono application and checks the MCP surface with the
official client SDK. It remains a local fixture, not a deployment or external credential provider.

## Discovery filtering

Help lists public reads by default. Applications may provide an async `canDiscover` callback for protected metadata and `surfaceExposure: { cli: { destructive: ['account:delete@1'] } }` for exact destructive exposure. Local help requires one unique local binding; remote help lists only public reads with one server binding. Direct destructive local invocation requires the explicit CLI exposure entry before input reaches a binding, and the shared executor independently checks authorization. Close `canDiscover` over a trusted caller from the application's auth boundary; do not infer identity from argv.

## Exact runner options

The [generated API and CLI reference](reference.md) lists every package import
and each argument recognized by the current parser. `npm run docs:check`
compares that page with the package manifest and CLI source.

With Node.js 22 or newer, run `npm ci` then `npm run example:e10` at the repository
root. In its exported project, `npm run search -- --query night --limit 1` yields the
same versioned result envelope as the existing function. An empty query exits 2 with
`invalid-input`; pass a nonempty query to repair it. See the
[E10 CLI fixture](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/README.md).
