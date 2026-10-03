# HTTP and OpenAPI adapter

Import the HTTP adapter from its separate package entrypoint:

```ts
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
```

`createHttpHandler(registry, options)` returns a handler from the standard Web `Request` API to
`Response`. Mount that function in a framework or server of your choice. The core contract and
executor remain independent of HTTP, Node, and framework modules.

The default base path is `/agent-native/v1`. Public, read-only capabilities receive a deterministic
`POST /agent-native/v1/capabilities/{namespace}/{name}/v{major}/invoke` route. The endpoint is a
generic capability invocation, not a generated REST resource API. By default there is no GET
invocation route; a GET to a visible invocation path receives `405` with `Allow: POST`.

A definition may preserve an established read route with a contract-level override:

```ts
surfaces: {
  http: {
    path: '/api/content/search',
    method: 'GET',
    query: { query: 'q' },
  },
}
```

The `query` map runs from input property to query parameter. GET conversion supports string,
number, integer, boolean, string enum, and arrays of those scalar values; nested objects and other
lossy conversions fail when the HTTP adapter is created. GET overrides are rejected for write or
destructive capabilities. Paths must be absolute and unique across visible definitions. The same
override drives routing and OpenAPI parameters.

The adapter uses the shared executor for schema validation, authorization, binding selection, and
output validation. Its default authorization policy permits only definitions explicitly marked as
public reads. Supply `resolveExecutionContext` to adapt a trusted authentication boundary; this
does not replace authorization in the executor. Hidden/protected definitions are omitted from the
public OpenAPI document and route map, and unknown paths return the same `404` shape.

OpenAPI 3.1 is generated directly from the public definitions' input/output `SchemaPort` values.
The same document is available at `GET /agent-native/v1/openapi.json`. A health observation at
`GET /agent-native/v1/health` records an actual protocol request as `UAN-003.http-protocol`.

The default request body limit is 32 KiB and can be set from 1 byte to 1 MiB with
`maxRequestBytes`. The default execution deadline is 10 seconds and the configurable maximum is
300 seconds. At a deadline the handler returns `504` and sets `context.signal.aborted`. Bindings
must observe that signal to stop their work; JavaScript cannot forcibly stop a handler that ignores
cooperative cancellation.

| Result | HTTP status |
| --- | ---: |
| Validated capability result | 200 |
| Visible capability path with an unsupported method | 405 (Allow: POST) |
| Malformed JSON | 400 |
| Capability missing or hidden | 404 |
| Body exceeds limit | 413 |
| Unsupported content type | 415 |
| Input schema failure | 422 |
| Handler or output schema failure | 500 |
| Binding/auth context unavailable | 503 |
| Execution deadline reached | 504 |

This slice has no framework-specific route installer, authenticated OpenAPI projection, GET override,
rate limiter, or provider deployment integration. A host remains responsible for transport security,
authentication, rate limiting, and deployment.
