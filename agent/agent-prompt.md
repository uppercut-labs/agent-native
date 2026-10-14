# Agent Native — website integration agent prompt

**Use:** Paste the text below into your preferred coding agent alongside access to your website repository. Replace the bracketed task only if you have a specific operation in mind. The prompt works without a skill plugin or private Uppercut materials.

---

I want to make **this existing website genuinely agent-native** using the published MIT-licensed `@uppercut-labs/agent-native` TypeScript library, not replace the website with a chatbot and not merely build a synthetic demo. Your task is to add a real, typed, permission-checked agent-callable capability built on an existing function or application operation.

My target operation, if specified: **[Describe one real operation; otherwise identify and implement the most useful existing public read.]**

Read the repository instructions, package manifest, lockfile, framework, routes, current human workflows, authentication boundaries and relevant source code before changing anything. Use the Agent Native integration skill if installed; if not, rely on official public docs: https://github.com/uppercut-labs/agent-native/blob/main/docs/installation.md and the existing-function retrofit at https://github.com/uppercut-labs/agent-native/tree/main/examples/e10-existing-functions-retrofit. Check the installed npm package's exports before assuming option names. The inspected version is `1.0.0` and requires Node.js 22+; do not silently upgrade the app's framework or optional peers.

Choose a minimal implementation that respects the site's actual architecture. Start with an **existing public read** unless my request specifically authorizes authenticated actions. Define a versioned capability with real input/output schemas, honest risk/access metadata, an explicit runtime binding to the existing domain function, and a checked registry. Use an application-owned authorization port on **every invocation**. Preserve current human UI, working APIs, records, routes and auth.

Expose an actual useful agent surface, not just a local registry. If this website has a server, prefer HTTP/OpenAPI for public reads and, where useful, official MCP Streamable HTTP. If it is static, retain its static output and use a separately hosted server/Worker sidecar for remote tool calls, or explain precisely why a server cannot be provided within this work scope. If Next App Router, use its documented Node route adapter; if Astro, use its supported mode deliberately. Browser WebMCP is optional/experimental and requires normal UI fallback. There is **no** global `agent-native init` CLI, no automatic discovery of business operations, and no built-in production identity/grant service.

Never turn protected customer data, user-specific operations, writes or destructive actions into public tools. For protected MCP functionality, use the host's real verified identity, current scopes, application-persisted grants and per-record authorization; do not use a fixture store or unconditional allow-all. Don't place tokens or server-only SDKs in client bundles. Don't create paid services, change DNS, deploy, publish a package, change external permissions, or modify production records unless separately authorized.

**Execute the implementation and its local tests**, not just a plan. First write a short source-grounded integration outline. Then make minimal focused changes. Prove one real successful call on the chosen surface, at least one invalid-input rejection **before handler execution**, at least one denied/hidden path, and one existing human website flow still works. For MCP, use an actual compatible MCP client and inspect `structuredContent.result`; for HTTP, test the actual mounted route and method/schema. If a deployment or commercial host wasn't tested, label it *unverified*, not complete. Avoid fake green tests, invented commands and unused scaffolding.

Finish with the implemented capability name/version, real function reused, risk/access policy, chosen runtime and surface, file diffs, install/test commands, observed positive and negative outputs, known limits, needed owner-owned deployment/auth steps, and a rollback plan. If important access or an authorized external action is missing, complete independent safe work and precisely identify what remains blocked.

---
