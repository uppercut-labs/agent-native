# E05 - Node/Hono capability host and CLI

E05 is a synthetic album-lab application for Node.js 22 or newer. One capability registry backs a
single Hono application that mounts the package's generated HTTP handler under `/agent-native/v1`
and its Streamable HTTP MCP handler at `/mcp`. The application CLI invokes the same lookup locally
or through HTTP; it does not reimplement either protocol.

The repository command below builds and packs the library, exports this directory, writes a
standalone `package.json` and lockfile, runs `npm ci`, then tests and runs the local CLI:

```sh
npm run example:e05
```

In an already exported copy, the equivalent prerequisites and checks are:

```sh
node --version # v22 or newer
npm install
npm test
```

## Local CLI

Local mode still passes through the shared executor and the fixture's authorization policy:

```sh
node src/cli.mjs --mode local example.catalog:album.lookup@1 --slug first-light
```

Stdout contains one machine-readable line:

```json
{"schemaVersion":"uan.cli-result/v1","target":{"mode":"local","capabilityId":"example.catalog:album.lookup@1"},"result":{"kind":"success","capabilityId":"example.catalog:album.lookup@1","value":{"kind":"found","album":{"slug":"first-light","title":"First Light"}}}}
```

Stderr reports `target=local capability=example.catalog:album.lookup@1`. It never carries the
result or a credential.

## Server and remote CLI

Use a synthetic local token, supplied only through the environment. Do not place it in argv:

```sh
E05_TOKEN=local-demo-token npm run server
```

The server binds `127.0.0.1:8787` by default and reports
`listening=http://127.0.0.1:8787` on stderr. In a second terminal, define the local credential
profile and invoke the HTTP surface:

```sh
export UAN_PROFILE_DEMO_URL=http://127.0.0.1:8787
export UAN_PROFILE_DEMO_TOKEN=local-demo-token
node src/cli.mjs --mode remote --profile demo example.catalog:album.lookup@1 --slug first-light
```

Remote stdout has the same `result.value` as local mode and stderr reports
`target=remote capability=example.catalog:album.lookup@1 profile=demo`. HTTP requires the demo
bearer token. MCP is intentionally anonymous, public, and read-only in this fixture; the core MCP
adapter still gates `tools/list` and `tools/call`, and no identity is derived from MCP `clientInfo`.

For a negative path, an unknown major version fails closed with exit 1 and a
`capability-missing` result:

```sh
node src/cli.mjs --mode local example.catalog:album.lookup@2 --slug first-light
```

Exit 0 means success, 2 means invalid input, 3 means authorization denied, and 1 means another
failure. Malformed JSON, missing profiles, shell metacharacters, timeouts, handler errors, port
conflicts, signal shutdown, and malformed transport requests are covered by the fixture tests.

Stop the server with `Ctrl-C`, then remove the shell-only profile values:

```sh
unset UAN_PROFILE_DEMO_URL UAN_PROFILE_DEMO_TOKEN E05_TOKEN
```

## Deployment boundary

This is local protocol evidence, not a deployed service or a claim of support for a commercial MCP
host. A deployment needs TLS, a production secret or identity provider, trusted principal
resolution, rate limiting, observability, process supervision, and a reviewed non-loopback bind or
reverse proxy. Replace the demo environment profile and token handling before any non-local use.
