# Installing only the surfaces you use

Agent Native is an unreleased preview at version 0.0.0. These commands describe the required peer dependencies for a future npm installation; current examples install a local tarball.

The root, contracts, composition, registry, executor, browser, HTTP, CLI and init subpaths need no runtime dependency from the package. Optional integrations are explicit:

| Imported subpath | Install alongside Agent Native |
| --- | --- |
| schema/zod | zod@4.6.5 |
| mcp or next | @modelcontextprotocol/server@2.3.0 |
| mcp-apps | @modelcontextprotocol/server@2.3.0 and @modelcontextprotocol/ext-apps@2.0.3 |
| astro | astro in the documented supported range |

The package does not install optional peers automatically. Application-owned routes, client libraries, framework adapters and deployment hosts remain separate. For example, the Astro on-demand fixture also installs @astrojs/node; the Next fixture installs Next and React. The browser-only E06 fixture installs Zod for its own schema and has no MCP server dependency.

Run npm run check:portability from this repository to build, pack, install in a fresh core/browser consumer and verify that optional adapters are absent. See the [UAN-022 measured evidence](evidence/UAN-022-package-portability.md) for the environment, sizes and Worker fixture result.
