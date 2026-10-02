# Architecture slice

The public v0 runtime slice has four core steps:

1. `defineCapability` freezes identity and requires contract schemas, risk, and access metadata.
2. `bindCapability` associates a definition with an implementation and explicit runtime targets.
3. `createCapabilityRegistry` rejects duplicate identities and invalid binding references. It does
   not create a process-global registry.
4. `executeCapability` selects only exact runtime matches, validates input, calls the required
   authorization port on each invocation, runs the selected handler, and validates output.

The core entrypoint and its contract, registry, and executor subpaths contain no Node, DOM,
framework, provider, or server imports. Consumers keep server handlers in their server application
and register only bindings appropriate to each runtime. Package tests compile and scan a browser
contract entrypoint against a fake secret sentinel held in a test-only server module.

Risk and access are contract intent. An authorization port makes the per-invocation policy
decision. Durable grant persistence, identity integration, discovery filtering, transport adapters,
server hosting, browser registration, and framework installers are outside this implementation
slice.

See [capabilities and bindings](docs/capabilities-and-bindings.md) for the frozen API and runnable
examples. The UAN-001 and UAN-002 local evidence files state what was tested and what remains
unverified.
