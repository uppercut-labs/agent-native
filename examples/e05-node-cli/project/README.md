# E05 - Node CLI invocation parity

This installed example runs the same versioned album lookup locally or through the shared HTTP adapter.
Its CLI is generated from the capability registry: help lists the identity and derives simple field flags
from the input schema. Complex values use `--input-json`.

Run `npm run example:e05` at the library root to export this project with the package tarball,
install it in a separate directory with a lockfile, and run its tests. The normal local command is
`npm start`; it writes the versioned result JSON to stdout and its effective target to stderr.

For a remote run, start `E05_TOKEN=local-demo-token npm run server` in a separate terminal. In the CLI terminal, set
`UAN_PROFILE_DEMO_URL=http://127.0.0.1:8787` and `UAN_PROFILE_DEMO_TOKEN=local-demo-token`, then run:

```sh
node src/cli.mjs --mode remote --profile demo example.catalog:album.lookup@1 --slug first-light
```

Remote mode requires the named profile and sends its token as a bearer credential. Do not put the
token in command arguments. The server's port is configurable with `PORT`.

Negative cases include invalid slugs, malformed stdin JSON, unavailable profiles, unknown versions,
denied remote calls, server errors and request timeouts. Exit 0 means success, 2 means invalid input,
3 means authorization denied, and 1 means other failures. Stdout always carries a JSON result with
schema version `uan.cli-result/v1`; diagnostic target/error lines go to stderr. Values are passed
through argument arrays in the tests; this CLI never interpolates arguments into a shell command.

This fixture uses Node's built-in HTTP server to adapt the library's framework-neutral handler. It is
not a Hono integration or a deployed-host proof.
