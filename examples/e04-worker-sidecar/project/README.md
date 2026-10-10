# E04 Cloudflare Worker sidecar

This sample runs E01's public album capability in a separate Cloudflare Worker sidecar. E01 remains an Astro static site. The exporter copies E01's canonical public album data, capability contract, and sidecar diagnostics into the isolated Worker fixture, so the browser and Worker share definition, schema, lookup function, data, and SHA-256 revision.

## Local verification

From the Agent Native repository root, run npm run example:e04. The script packages and installs a standalone fixture, runs the negative-path tests, inspects the Worker bundle with Wrangler's dry-run build, and starts Wrangler locally on workerd. It exercises health, OpenAPI, HTTP invocation, exact-origin CORS, denied Host/Origin requests, and the official MCP SDK client. It also runs `src/cli.mjs`, an application-owned CLI that reuses the same shared E01 contract and registry. The CLI makes a remote call to the sidecar's generated HTTP route, and the verifier checks a found album, a missing credential profile and invalid input. That CLI runs in Node and is not part of the Worker bundle. The MCP test is a server-side client with no browser Origin; it negotiated MCP protocol 2025-11-25.

The pins are Wrangler 4.147.0, MCP SDK 2.3.0, Zod 4.6.5, and Node >=22.12. To run the local Worker manually from the exported fixture, use npm run start. The Astro static build remains separate and is verified by npm run example:e01.

## Configuration

wrangler.jsonc sets CATALOG_REVISION to the SHA-256 revision exported by the canonical E01 contract, SIDECAR_HOST to the accepted Worker hostname, and ALLOWED_ORIGIN to the exact static-site origin permitted for browser health/HTTP requests. For a local static preview the fixture uses http://localhost:4321. Replace these values for a host you control.

Build E01 with PUBLIC_AGENT_NATIVE_SIDECAR_ORIGIN set to the Worker sidecar URL. PUBLIC_AGENT_NATIVE_ROUTE_MODE defaults to sidecar; use same-origin only when the hosting layer actually routes /mcp on the static origin to the Worker. A sidecar URL by itself does not create that route. Browser diagnostics separately report the sidecar origin, an absent expected same-origin route, missing catalog revision binding, and revision mismatch.

CORS here is limited to the configured browser origin for the public health/HTTP and browser diagnostics surfaces. Cross-origin browser MCP is not claimed or tested. Private capabilities need separate origin policy and security review.

## Operator commands

From the Agent Native repository root, first run `npm run example:e04` to export the standalone fixture. Then run these commands from `examples/e04-worker-sidecar/.exported`:

```sh
npx wrangler dev --local
npx wrangler deploy --dry-run --outdir .worker-bundle
```

A future production deploy would use `npx wrangler deploy` from that exported directory after setting the real `SIDECAR_HOST`, `ALLOWED_ORIGIN`, and `CATALOG_REVISION` and configuring the intended Cloudflare account and routing. No real deploy was run for this evidence. This fixture requires no paid binding, account provisioning, or DNS setup during local verification. The checks do not verify deployed Cloudflare behavior, custom domains, production CORS, or a real browser host.
