# Doctor, inspect, and authorized list

The experimental `@uppercut-labs/agent-native/doctor` entrypoint provides read-only diagnostic building blocks. Applications supply checks and observations; the package does not discover credentials, probe a host, modify project files, or invoke capability handlers on its own. The package is still private at version `0.0.0`.

## Machine report and exits

`runDoctor(checks, { profile })` returns a `uan.doctor-report/v1` report. `DOCTOR_REPORT_JSON_SCHEMA` describes its closed JSON shape. Every finding has a stable `checkId`, target, status, severity, timestamp, evidence kind and source, a location and references, an explanation, and a concrete next action. A profile names the selected and required check IDs, so a local-only pass cannot be confused with network or host verification.

| Exit | Meaning |
| --- | --- |
| `0` | Selected checks have no failures or required unknown/skipped findings. |
| `1` | At least one selected check failed. |
| `2` | Invalid check or profile configuration (`DoctorUsageError`). |
| `3` | No selected check failed, but a required check is unknown or skipped. |

An observer exception produces an `unknown` finding without copying its error text into the report. The caller should log private diagnostics through its own protected channel if needed. Evidence source distinguishes `fixture`, `mock`, and `real-host`; a configured value or loopback fixture is not real-host behavior evidence.

## Inspect and list

`inspectCapabilityRegistry(registry)` returns the effective definitions and bindings without running handlers. `listAuthorizedCapabilities(registry, { surface, exposure, authorize })` filters by the requested surface, compatible binding, discovery policy, and authorization. It does not grant access to protected capabilities or bypass execution-time authorization.

## Reproduce the local fault lab

From the repository root, run `npm run example:e11` for a fresh tarball install and eight fault/repair scenarios. In the exported E11 project, `node src/cli.mjs doctor missing-binding --repaired --profile local` selects six configuration and artifact checks, makes no network request, and exits `0`. The default `full` profile requires two more network checks. Without `--probe-loopback`, those checks are skipped and a repaired fixture exits `3`; no endpoint is `unknown` and also exits `3`. The example README explains the optional loopback health fixture and its exact commands. No default check calls the destructive canary.

A real deployment needs its own check implementations, trusted identity provider, endpoint, and evidence collection. E11 does not certify a browser, commercial MCP host, or production credential.

See [permissions and discovery](permissions-and-discovery.md), [fixture compatibility](compatibility.md), and the [E11 example README](https://github.com/uppercut-labs/agent-native/blob/main/examples/e11-diagnostics-fault-lab/project/README.md).

## Source-backed profile selection

With Node.js 22 or newer, run `npm ci` and `npm run example:e11` from the package root.
The fixture defines its local and full required-check profiles in source:

<!-- source:examples/e11-diagnostics-fault-lab/project/src/doctor.mjs#doctor-profiles -->
~~~js
export const E11_DOCTOR_PROFILES = Object.freeze({
  local: Object.freeze({
    id: 'local',
    selectedCheckIds: Object.freeze(LOCAL_CHECK_IDS),
    requiredCheckIds: Object.freeze([...LOCAL_CHECK_IDS]),
  }),
  full: Object.freeze({
    id: 'full',
    selectedCheckIds: Object.freeze(FULL_CHECK_IDS),
    requiredCheckIds: Object.freeze([...FULL_CHECK_IDS]),
  }),
});
~~~

[View tested source](https://github.com/uppercut-labs/agent-native/blob/main/examples/e11-diagnostics-fault-lab/project/src/doctor.mjs#L30)
<!-- /source -->

A repaired fixture under `--profile local` exits 0; the same fixture under the default
full profile exits 3 until the optional loopback endpoint checks are actually run. An unknown
scenario fails before creating a sandbox. See [E11 commands and sandbox cleanup](https://github.com/uppercut-labs/agent-native/blob/main/examples/e11-diagnostics-fault-lab/project/README.md).
