# Generated package and CLI reference

This page is generated from [package.json](../package.json) and the
[CLI parser](https://github.com/uppercut-labs/agent-native/blob/main/src/cli.ts). Run `node docs-site/reference.mjs` after changing those
sources. `npm run docs:check` fails if this page drifts. Agent Native
`0.1.0` is a preview; verify registry availability before npm installation.

## Typed package entrypoints

| Import specifier | Type declaration | ESM implementation |
| --- | --- | --- |
| `@uppercut-labs/agent-native` | `./dist/index.d.ts` | `./dist/index.js` |
| `@uppercut-labs/agent-native/contracts` | `./dist/core/contracts.d.ts` | `./dist/core/contracts.js` |
| `@uppercut-labs/agent-native/composition` | `./dist/core/composition.d.ts` | `./dist/core/composition.js` |
| `@uppercut-labs/agent-native/registry` | `./dist/registry.d.ts` | `./dist/registry.js` |
| `@uppercut-labs/agent-native/executor` | `./dist/core/executor.d.ts` | `./dist/core/executor.js` |
| `@uppercut-labs/agent-native/cli` | `./dist/cli.d.ts` | `./dist/cli.js` |
| `@uppercut-labs/agent-native/http` | `./dist/http.d.ts` | `./dist/http.js` |
| `@uppercut-labs/agent-native/schema/zod` | `./dist/adapters/zod.d.ts` | `./dist/adapters/zod.js` |
| `@uppercut-labs/agent-native/diagnostics` | `./dist/core/diagnostics.d.ts` | `./dist/core/diagnostics.js` |
| `@uppercut-labs/agent-native/doctor` | `./dist/doctor.d.ts` | `./dist/doctor.js` |
| `@uppercut-labs/agent-native/mcp` | `./dist/mcp.d.ts` | `./dist/mcp.js` |
| `@uppercut-labs/agent-native/browser` | `./dist/browser.d.ts` | `./dist/browser.js` |
| `@uppercut-labs/agent-native/astro` | `./dist/astro.d.ts` | `./dist/astro.js` |
| `@uppercut-labs/agent-native/next` | `./dist/next.d.ts` | `./dist/next.js` |
| `@uppercut-labs/agent-native/next/browser` | `./dist/next-browser.d.ts` | `./dist/next-browser.js` |
| `@uppercut-labs/agent-native/init` | `./dist/init.d.ts` | `./dist/init.js` |
| `@uppercut-labs/agent-native/auth` | `./dist/auth.d.ts` | `./dist/auth.js` |
| `@uppercut-labs/agent-native/mcp-apps` | `./dist/mcp-apps.d.ts` | `./dist/mcp-apps.js` |

The package's optional peers are listed in [installation](installation.md). Import only
the subpath needed by the application. A package-level executable is not shipped.

## Application CLI arguments

The application calls `runCapabilityCli(argv, options, streams)`. One command or
canonical capability ID is positional. A command override or alias retains the
canonical identity and has no version fallback.

| Argument | Value and default | Boundary |
| --- | --- | --- |
| `--mode` | local or remote | Required for invocation; remote needs a profile. |
| `--profile` | lowercase slug (1-32 characters) | Remote only. |
| `--binding-id` | exact binding ID | Local only. |
| `--timeout-ms` | integer 1-300000 (default 10000) | Remote request deadline. |
| `--input-json` | JSON document or - for stdin | Cannot combine with field flags. |
| `--<field>` | typed scalar from input schema | Complex fields use `--input-json`. |
| `--help` or `-h` | no value | Lists visible capabilities. |
| `--version` | no value | Displays the application's supplied package version. |

For a runnable instance, use Node.js 22 or newer, `npm ci`, and
`npm run example:e10` from the repository root. The exported E10 CLI runs
`npm run search -- --query night --limit 1` successfully. An empty query exits
2 with `invalid-input`; provide a nonempty query to retry. See
[CLI behavior](cli.md) and [E10 instructions](https://github.com/uppercut-labs/agent-native/blob/main/examples/e10-existing-functions-retrofit/project/README.md).

## Typed adapter configuration

These exported declarations are copied from the checked TypeScript source at build time.
Framework mounts and security ownership are explained in the linked guides.

### CLI

[View source](https://github.com/uppercut-labs/agent-native/blob/main/src/cli.ts)

~~~ts
export type CliCredentialProfile = {
  readonly baseUrl: string;
  readonly token: string;
};

export type CapabilityCliOptions = {
  readonly registry: CapabilityRegistry;
  readonly authorization: AuthorizationPort;
  readonly caller: ExecutionCaller;
  readonly credentialProfiles?: Readonly<Record<string, CliCredentialProfile>>;
  readonly packageVersion?: string;
  readonly fetcher?: typeof fetch;
  readonly surfaceExposure?: CapabilitySurfaceExposure;
  readonly canDiscover?: (
    definition: CapabilityDefinition<unknown, unknown>,
  ) => boolean | Promise<boolean>;
};
~~~

### HTTP

[View source](https://github.com/uppercut-labs/agent-native/blob/main/src/http.ts)

~~~ts
export type HttpAdapterOptions = {
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
  readonly deadlineMs?: number;
  readonly resolveExecutionContext?: (
    request: Request,
  ) => HttpExecutionContext | Promise<HttpExecutionContext>;
};
~~~

### MCP

[View source](https://github.com/uppercut-labs/agent-native/blob/main/src/mcp.ts)

~~~ts
export type McpAdapterOptions = {
  readonly endpoint?: string;
  readonly surfaceExposure?: CapabilitySurfaceExposure;
  readonly maxRequestBytes?: number;
  readonly deadlineMs?: number;
  readonly canDiscover?: (
    definition: CapabilityDefinition<unknown, unknown>,
    request: Request,
  ) => boolean | Promise<boolean>;
  readonly discoverProtected?: (
    definition: CapabilityDefinition<unknown, unknown>,
    request: Request,
    authInfo: AuthInfo,
  ) => boolean | Promise<boolean>;
  readonly bearerAuth?: {
    readonly verifier: OAuthTokenVerifier;
    readonly expectedResource: URL;
    readonly requiredScopes?: readonly string[];
    readonly resourceMetadataUrl?: string;
  };
  // AuthInfo comes from the SDK verifier; issuer/subject/tenant must be supplied by that
  // verifier's trusted metadata, never inferred from request headers or MCP clientInfo.
  readonly resolveTrustedPrincipal?: (
    authInfo: AuthInfo,
  ) => TrustedPrincipal | null | Promise<TrustedPrincipal | null>;
  readonly grantAuthorization?: Omit<GrantAuthorizationOptions, 'principal'>;
  readonly resolveExecutionContext?: (
    request: Request,
    authInfo?: AuthInfo,
  ) => McpExecutionContext | Promise<McpExecutionContext>;
};
~~~

### Doctor

[View source](https://github.com/uppercut-labs/agent-native/blob/main/src/doctor.ts)

~~~ts
export type DoctorRunOptions = {
  readonly now?: () => Date;
  readonly profile?: DoctorCheckProfile;
};
~~~
