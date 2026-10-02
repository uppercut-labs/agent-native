# E01 domain execution slice

This independently installable local example exercises UAN-002's album lookup definition,
binding, runtime selection, authorization hook, and output validation. It prints:

```text
{"kind":"found","album":{"slug":"first-light","title":"First Light"}}
```

Run `npm run example:e01` from the package repository to build and pack the library, export this
project with the local tarball, install it independently, run tests, and check the CLI. The
negative fixture passes a malformed slug and expects `invalid-input` before any handler can
return a result.

This is the E01 domain-contract and local-execution slice. It does not implement Astro retrofit,
browser registration, a server sidecar, MCP, HTTP/OpenAPI, generated CLI support, or a real host.
