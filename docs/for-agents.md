# Let a coding agent integrate Agent Native

The quickest way to make an existing website agent-native is to give a coding agent the **website repository** and a bounded, source-grounded task. Agent Native provides **application capabilities**, not a turnkey chat overlay or magic remote execution of a site.

Canonical source assets: [portable skill](../skill/agent-native/SKILL.md),
[adapter selection](../skill/agent-native/references/adapter-decision.md),
[verification](../skill/agent-native/references/verification.md),
[full prompt](../agent/agent-prompt.md), and [short prompt](../agent/agent-prompt-short.md).

For local skill installation, keep `SKILL.md` and both reference files together:

```text
agent-native/
  SKILL.md
  references/
    adapter-decision.md
    verification.md
```

The npm archive includes this folder under `skill/agent-native/`. Downloading only
`SKILL.md` requires fetching its two linked references as well. The standalone prompt
is a single file.

There are two independent instructions paths:

- **Portable Agent Native skill:** a short `SKILL.md` for agents supporting portable Agent Skills format, with optional references for adapter selection and verification. Read the skill source from the public package, or download the canonical asset from Uppercut's documentation host when that route is available.
- **Standalone agent prompt:** copy/paste text for any coding agent with repository access. It includes necessary behavior without requiring a skill/plugin installation.

**Planned download destinations:** `https://docs.uppercut-labs.com/agent-native/skill/agent-native/SKILL.md` and `https://docs.uppercut-labs.com/agent-native/agent-prompt.md`. Verify the returned content is actual Markdown before giving either link to users; these paths are not promised live until separately published and tested. The public package repository remains the authoritative source.

## What the agent should accomplish

1. Read the site's existing framework, runtime, source, tests, auth and repository instructions.
2. Choose a real existing public read, not arbitrary generated demo logic, and create a typed capability with honest risk/access.
3. Bind the unchanged application function in a checked registry and enforce authorization every call.
4. Expose one real HTTP or official MCP surface with the correct runtime and optional dependencies. A static site cannot run dynamic MCP unaided.
5. Verify one allowed call, one schema rejection before the handler, one denial/hidden path and an unchanged human UI.
6. Report changed files, versions, observed commands/results and remaining hosting/identity responsibilities.

Do not claim that the 1.0.0 library includes a global `agent-native init` executable, production identity service, default-enabled browser WebMCP or verified commercial MCP Apps host rendering. Review [support and limitations](support-and-limitations.md).

## If the agent only has public docs

Start with [adopt an existing site](adopt-existing-site.md), [install the published package](installation.md), and [E10 unchanged-function retrofit](https://github.com/uppercut-labs/agent-native/tree/main/examples/e10-existing-functions-retrofit). For remote operations use [HTTP](http.md) or [MCP](mcp.md) according to app runtime. For authenticated operations read [permissions and discovery](permissions-and-discovery.md), with a real trusted auth source and record policy. Never paste user tokens into chat or code.

## What the agent does **not** gain

The skill and prompt are just text. They do not give a coding agent automatic GitHub access, credentials, permission to deploy, cross-tenant record authorization or a general hosted MCP endpoint. The integrating owner must grant the agent appropriate repository/test access separately and approve production actions. The report must distinguish a local capability run, local protocol integration and live host verification.
