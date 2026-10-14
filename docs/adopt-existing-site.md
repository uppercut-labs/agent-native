# Make an existing website agent-native

**Target:** Agent Native 1.0.0 · Node.js 22+ · an existing JavaScript/TypeScript website.  
**Result:** A real operation the website already supports, available to an agent over an actual HTTP and/or MCP server surface, with the same input checks and explicit authorization the application expects.

Agent Native is not a chatbot widget or an automatic site conversion tool. It defines reusable operations that software—including suitable agents—can discover and invoke through selected adapters. Your existing pages, functions and ownership rules remain your responsibility.

## 1. Identify one operation your website already provides

Choose something low risk: search public content, retrieve an album, list public catalog entries, or convert a value. Find the *existing function* your website already calls. Prefer a public read on your first pass, not user-specific private data or an update/delete. Record the input/output shape and whether an ordinary visitor is entitled to the result.

A representative complete example is [E10 existing functions retrofit](https://github.com/uppercut-labs/agent-native/tree/main/examples/e10-existing-functions-retrofit). It leaves an existing `searchContent({query, limit})` function intact, defines a typed Agent Native capability around it, and preserves the site's established `GET /api/content/search` shape. It is much closer to a real integration than inventing a new `greet` operation.

Check which execution model your website actually has before choosing an adapter:

| Your website | How remote agents call it | Example and limitation |
| --- | --- | --- |
| Existing Node/Hono server | Mount a standard Web `Request`/`Response` HTTP or MCP handler in your current router | [E05](https://github.com/uppercut-labs/agent-native/tree/main/examples/e05-node-cli); app must provide TLS/auth/rate limits |
| Next.js App Router | Use package `/next` route factory on Node runtime | [E03](https://github.com/uppercut-labs/agent-native/tree/main/examples/e03-next-reading-list); keep registry server-only |
| Astro on-demand | Add app-owned endpoints with an existing compatible server adapter | [E02](https://github.com/uppercut-labs/agent-native/tree/main/examples/e02-astro-on-demand-catalog); do not silently change output modes |
| Astro fully static | Use a separate Worker/sidecar server for HTTP/MCP while leaving site prerendered | [E01/E04](https://github.com/uppercut-labs/agent-native/tree/main/examples); static HTML cannot answer a dynamic remote MCP request by itself |
| Browser-local only | Optional WebMCP browser registration with ordinary human fallback | [E06](https://github.com/uppercut-labs/agent-native/tree/main/examples/e06-browser-only-theme-controls); draft browser API, not universal host support |

## 2. Install the version you can actually test

In the consuming website repository with Node 22 or later, install the public package:

```sh
npm install @uppercut-labs/agent-native@1.0.0
npm install zod@4.6.5
```

Zod is only needed if you use the `/schema/zod` adapter. To serve MCP, add the tested official server SDK peer separately:

```sh
npm install @modelcontextprotocol/server@2.3.0
```

No package-level `agent-native` executable ships. The `@uppercut-labs/agent-native/init` import is an experimental, narrowly recognized programmatic Astro static retrofit; it does **not** automatically discover your business functions, publish a Worker or install a global `init` command. See [installation](installation.md) and [Astro init details](getting-started.md).

## 3. Define and bind your **existing** function

E10's [capability module](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/src/capability.mjs) is a runnable reference. It uses:

- `defineCapability({identity, description, input, output, risk:'read', access:{kind:'public'}})` from `/contracts`;
- `fromZod(z.object(...))` from `/schema/zod` for input and output contracts;
- `bindCapability(capability, {id, targets:['local','server'], execute: existingFunction})` from `/registry`;
- `createCapabilityRegistry([capability], [binding])` to check definitions and bindings.

The tested definition, binding and public-read-only authorizer are:

<!-- source:examples/e10-existing-functions-retrofit/project/src/capability.mjs#adoption-contract -->
~~~js
const contentItem = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
});

export const searchContentCapability = defineCapability({
  identity: { namespace: 'content', name: 'search', majorVersion: 1 },
  description: 'Search the existing public content collection.',
  input: fromZod(
    z.object({
      query: z.string().trim().min(1).max(80),
      limit: z.number().int().min(1).max(10).optional(),
    }),
  ),
  output: fromZod(
    z.object({
      query: z.string(),
      results: z.array(contentItem),
    }),
  ),
  risk: 'read',
  access: { kind: 'public' },
  surfaces: {
    // docs:start http-get-override
    http: {
      path: '/api/content/search',
      method: 'GET',
      query: { query: 'q' },
    },
    // docs:end http-get-override
    // docs:start cli-command-override
    cli: {
      command: 'content-search',
      aliases: ['search'],
    },
    // docs:end cli-command-override
  },
});

export const searchContentBinding = bindCapability(searchContentCapability, {
  id: 'existing-content-search',
  targets: ['local', 'server'],
  execute: searchContent,
});

export const registry = createCapabilityRegistry([searchContentCapability], [searchContentBinding]);

export const publicReadAuthorization = {
  authorize(request) {
    return request.risk === 'read' && request.access.kind === 'public';
  },
};
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/src/capability.mjs#L8)
<!-- /source -->

The example preserves an established GET route with the same contract, instead of inventing a duplicate endpoint:

<!-- source:examples/e10-existing-functions-retrofit/project/src/capability.mjs#http-get-override -->
~~~js
http: {
  path: '/api/content/search',
  method: 'GET',
  query: { query: 'q' },
},
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/src/capability.mjs#L33)
<!-- /source -->

Identity namespace and name use lower-case slug segments separated by dots or hyphens,
such as `{ namespace: 'blog', name: 'list-posts', majorVersion: 1 }`.

For your own site, adapt the namespace/operation names and input/output schemas from the actual operation. A registry is not a permission policy: supply an application authorization port **on every execution**, even for explicitly public reads. The E10 sample authorizer permits exactly public reads. Do not copy it to a protected write or assume an unauthenticated visitor owns someone else's data. [Capabilities and bindings](capabilities-and-bindings.md) explains this boundary.

## 4. Mount the agent surface in an actual server

E10's [HTTP mount](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/src/http.mjs) wraps the same registry in `createHttpHandler` from `@uppercut-labs/agent-native/http`, supplying a caller and explicit `authorization` through `resolveExecutionContext`. It adapts the Web-standard handler to its pre-existing Node HTTP server and leaves unrelated `/api/health` and content routes intact.

<!-- source:examples/e10-existing-functions-retrofit/project/src/http.mjs#adoption-http -->
~~~js
const generatedHandler = createHttpHandler(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/src/http.mjs#L7)
<!-- /source -->

By default, public read capabilities may be invoked by `POST /agent-native/v1/capabilities/{namespace}/{name}/v{major}/invoke` and are described at `GET /agent-native/v1/openapi.json`; E10 demonstrates an approved GET override at the original path. The HTTP adapter in 1.0.0 exposes **only public reads**; user-specific or destructive operations are not automatically routable. See [HTTP/OpenAPI](http.md).

For agent-native MCP clients, add the isolated `/mcp` adapter and mount it at a real `/mcp` route, with the host's request-specific authorization context. Use the official MCP server SDK and a compatible MCP client. Successful structured results appear under `structuredContent.result`. MCP protected discovery, scopes, revocable grants and per-resource authorization are covered in [remote MCP](mcp.md) and [permissions](permissions-and-discovery.md). **Do not turn on protected MCP in the beginner read-only sample without an actual verified identity source.**

If your website has no server, select a separately deployed Worker or equivalent server to host those routes, wire CORS/host/origin carefully and keep the static site untouched. Local workerd evidence is not a claim that your DNS or production Worker was deployed. See [static sites](static-sites.md).

## 5. Prove the behavior, including a refusal

For the checked E10 example, run this in the *public package source repository* to export and exercise its independent copy:

```sh
npm ci
npm run example:e10
```

To verify the published registry package independently, run `npm run check:adoption`.
It installs 1.0.0 in a clean consumer, preserves the E10 domain function, runs its HTTP/CLI
tests, and uses the official MCP client over an actual local socket. The client validates
`structuredContent.result`, rejects invalid input before the function, and cannot discover
or call a protected canary. This is maintainer loopback proof, not an outsider pilot.

Inside the generated E10 project, the [README](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/README.md) documents `npm ci`, `npm test`, `npm run search -- --query night --limit 1`, `npm start` and `curl 'http://127.0.0.1:8788/api/content/search?q=night&limit=1'`. In this fixture, that URL returns its first search match. Missing query, a fractional limit or an empty CLI query fails input validation before executing the existing function. POST to the preserved read GET route returns `405` with `Allow: GET`; unrelated health and catalog routes remain available.

For **your site**, perform the equivalent on its actual local server, not the package fixture. Record the operation name and version, URL/host, expected schema, valid result, malformed input failure, denied or hidden operation, and unchanged human website flow. For MCP, use a compatible client to list tools and call one (not a hand-built success assertion). If only local route tests passed, describe that honestly; deployed provider and live commercial-host claims require separate verification. See [compatibility](compatibility.md) and [support limits](support-and-limitations.md).

## 6. Take it from local proof to a deployed project

Your application owns deployment routing, TLS, Origin/Host/CORS rules, rate limits, credential verification, resource authorization, persistence, secret management, observability and rollback. Never put server SDKs, credential stores or private schemas in browser assets. Calls that time out may still have completed writes; don't retry a mutation blindly without a real idempotency contract and state check.

Use [release/provider handoff](release-handoff.md) to plan actual host acceptance, and [doctor and troubleshooting](doctor-and-troubleshooting.md) if a binding/route is unavailable. Treat the current [stability](stability.md) and [support matrix](support-and-limitations.md) as release-specific.

## Hand this to a coding agent

For a repo-aware AI assistant, read [the agent integration guide](for-agents.md) and give it the portable skill or copyable prompt. Neither automatically grants access to the customer's site, deployment credentials or private operations.
