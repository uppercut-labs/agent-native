# UAN-022 cross-platform optional-integration license and notice review

Checked 2026-10-10 on macOS arm64 with Node 26.10.0 and npm 11.19.1. The consumer depended on the published `@uppercut-labs/agent-native@0.1.1` registry tarball (SHA-256 `a1ce884f89eadba319d6fbad5c9b09b05575a7ab15998bcfd4a6ad8cc8228fbb`) plus the pinned optional integrations `@modelcontextprotocol/server@2.3.0`, `@modelcontextprotocol/ext-apps@2.0.3`, `astro@7.3.5` and `zod@4.6.5`. This extends the [macOS-only inventory](UAN-022-overhead-license-audit.md) to Linux and Windows package trees. It is a package-metadata and shipped-file review, not legal advice.

## Method

For each target, a fresh project ran `npm install --ignore-scripts --no-audit --no-fund --os=<os> --cpu=<cpu>` (and `--libc=glibc` for Linux). npm then installs the platform-specific optional packages for that target instead of the host's. Every `package-lock.json` entry was matched to a physically installed `package.json`; its `name`, `version` and `license` were recorded, along with any top-level `LICENSE`, `COPYING`, `NOTICE`, `THIRD-PARTY` or `AUTHORS` file. The native binaries were installed, not executed: this checks what an application would redistribute, not runtime behavior on those operating systems.

## Result by target

| Target | Lockfile paths | Installed packages | Without a top-level license file |
| --- | ---: | ---: | ---: |
| darwin arm64 | 304 | 205 | 9 |
| linux x64 glibc | 304 | 204 | 9 |
| linux arm64 glibc | 304 | 204 | 9 |
| win32 x64 | 304 | 203 | 8 |

Every installed manifest declared a license. Across targets the license set is the same: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, CC0-1.0, MPL-2.0, Python-2.0 and LGPL-3.0-or-later. The only differences between targets are the native packages for Astro's compiler, Satteri, esbuild, Rolldown, Sharp/libvips and Lightning CSS, plus macOS-only `fsevents`. Since the earlier inventory, transitive `@rolldown/binding-*` moved from 1.2.12 to 1.2.13 (MIT), and `@img/sharp-win32-x64@0.35.5` declares `Apache-2.0 AND LGPL-3.0-or-later`.

## Packages that need application attention

| Package | Targets | License | Shipped notice |
| --- | --- | --- | --- |
| `@img/sharp-libvips-<platform>@1.3.4` | darwin arm64, linux x64, linux arm64 | LGPL-3.0-or-later | No license text. The README has a table of component licenses. |
| `@img/sharp-win32-x64@0.35.5` | win32 x64 | Apache-2.0 AND LGPL-3.0-or-later | Has a `LICENSE` file, but it contains only Apache-2.0 text, not the LGPL text. It bundles `libvips-42.dll`. |
| `lightningcss` and `lightningcss-<platform>@1.33.0` | all | MPL-2.0 | `LICENSE` present |
| `argparse@2.0.1` | all | Python-2.0 | `LICENSE` present |
| `lru-cache@11.5.3`, `sax@1.6.1`, `common-ancestor-path@2.0.0` | all | BlueOak-1.0.0 | `LICENSE.md` present |
| `mdn-data@2.0.28`, `mdn-data@2.27.1` | all | CC0-1.0 | `LICENSE` present |

Some MIT/ISC packages ship no top-level license file. They are the platform bindings for `@astrojs/compiler-binding`, `@bruits/satteri`, `@esbuild` and `@rolldown/binding`, plus `am-i-vibing`, `boolbase`, `piccolore` and `process-ancestry`. An application that redistributes them should take the notice from the parent project's repository.

## Decision

The Agent Native package itself has zero hard runtime dependencies. A core or browser consumer installs only the MIT tarball on every target, as `npm run check:portability` checks. All LGPL, MPL and other notice-bearing packages arrive only when an application chooses the Astro integration. Sharp/libvips arrives through Astro's image pipeline. These packages are present on every target, not just macOS, and on Windows the LGPL component ships inside an Apache-2.0-labeled package.

This closes the cross-platform inventory gate for the `0.1.1` preview. No change to the package or its peer ranges is needed. An application that bundles or redistributes an Astro build toolchain, especially a desktop or container image, must collect its own notices. It should use the versions its own lockfile resolves and should not rely on this snapshot. Server and static-site deployments that ship only Astro's build output do not redistribute these build-time packages.

To reproduce: create a project with the five dependencies above, run the install command once per target in an empty directory, and compare the lockfile entries with the installed manifests.
