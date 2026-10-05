# Installing only the surfaces you use

Agent Native `0.1.0` is a preview for Node.js 22 or newer. Once the version is visible on npmjs.com, install the package and only the peers your application imports:

```sh
npm install @uppercut-labs/agent-native@0.1.0
```

The public package has no global `agent-native` executable. Applications call its APIs or expose their own CLI runner. The repository examples independently install local tarballs so their checks stay tied to a source commit.

## First local capability

Add Zod for the schema adapter, then save the following as `quickstart.mjs` in your application:

```sh
npm install zod@4.6.5
```

```js
import { bindCapability, createCapabilityRegistry, defineCapability, executeCapability } from '@uppercut-labs/agent-native';
import { fromZod } from '@uppercut-labs/agent-native/schema/zod';
import * as z from 'zod';

const greet = defineCapability({
  identity: { namespace: 'demo', name: 'greet', majorVersion: 1 },
  description: 'Greet one person.',
  input: fromZod(z.object({ name: z.string().min(1) })),
  output: fromZod(z.object({ message: z.string() })),
  risk: 'read',
  access: { kind: 'public' },
});
const registry = createCapabilityRegistry(
  [greet],
  [bindCapability(greet, {
    id: 'local-greet',
    targets: ['local'],
    execute: async ({ name }) => ({ message: 'Hello, ' + name + '!' }),
  })],
);
const result = await executeCapability(registry, {
  identity: greet.identity,
  runtime: 'local',
  input: { name: 'World' },
  caller: { kind: 'anonymous' },
  authorization: { authorize: ({ access, risk }) => access.kind === 'public' && risk === 'read' },
});
if (result.kind !== 'success') throw new Error(result.reason);
console.log(result.value);
```

Run `node quickstart.mjs`; it prints `{ message: 'Hello, World!' }`. Every invocation supplies an authorization port, including public reads.

The root, contracts, composition, registry, executor, browser, HTTP, CLI and init subpaths need no runtime dependency from the package. Optional integrations are explicit:

| Imported subpath | Install alongside Agent Native |
| --- | --- |
| harness | No runtime dependency; neutral contracts only |
| schema/zod | zod@4.6.5 |
| mcp or next | @modelcontextprotocol/server@2.3.0 |
| mcp-apps | @modelcontextprotocol/server@2.3.0 and @modelcontextprotocol/ext-apps@2.0.3 |
| astro | astro in the documented supported range |

The package does not install optional peers automatically. Application-owned routes, client libraries, framework adapters and deployment hosts remain separate. For example, the Astro on-demand fixture also installs @astrojs/node; the Next fixture installs Next and React. The browser-only E06 fixture installs Zod for its own schema and has no MCP server dependency.

Run npm run check:portability from this repository to build, pack, install in a fresh core/browser consumer, verify that optional adapters are absent, and smoke-test the application-owned CLI adapter. See the [UAN-022 measured evidence](evidence/UAN-022-package-portability.md) for the environment, sizes and Worker fixture result.

## Check a fresh consumer

Use Node.js 22 or newer. From the repository root, run `npm ci` followed by
`npm run check:portability`. The check packs the current source, installs
a core/browser consumer without optional peers, verifies imports and the packed
CLI, and checks every declared export in the tarball. A missing
`@modelcontextprotocol/server` error from `/mcp` means the application needs
that peer; install it only for that server integration. The independent repository examples continue to use local tarballs.
