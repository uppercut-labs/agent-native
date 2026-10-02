# Uppercut Agent Native

This directory begins the implementation workspace for Uppercut Agent Native. The package
working name is `@uppercut-labs/agent-native`; its manifest is deliberately `private: true` and
version `0.0.0`, so npm cannot publish this scaffold accidentally.

## Current scope

UAN-001 establishes a strict TypeScript baseline, a dependency-free contract entrypoint, a
separate Zod adapter, a JSON Schema projection spike, and stable diagnostic observations. It is
not a usable agent-native product yet. Remote MCP, WebMCP, MCP Apps, generated HTTP/OpenAPI, CLI,
framework installation, and authorization are not implemented.

E12 is a runnable standalone unit-converter example. `npm run example:e12` exports it with the
package tarball, generates its lockfile, installs it independently, and runs its tests. This does
not imply support for any MCP protocol surface or real host.

The `./contracts` entrypoint imports only the core contract module. It does not import Zod, Node,
DOM, framework, or provider modules. `npm run typecheck` includes a separate contract-import
fixture compiled with only the ES2022 library. This is a module-boundary smoke check, not proof of
compatibility with any real browser, client, or host.

## Development

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run example:e12
```

The schema spike checks album lookup and unit conversion input/output shapes with Zod 4, then
validates the exported draft-2020-12 schemas independently with Ajv. JSON Schema projection
throws for transforms that cannot be represented faithfully. No compatibility or deployment
claim follows from this isolated spike. The official MCP server SDK is a development-only
dependency for an upstream `any` to `unknown` validation-boundary fixture; the contract core does
not import it.

## Status

Not published. MIT is the selected license. See `VERSION-EVIDENCE.md` for pinned tool versions
and upstream references.
