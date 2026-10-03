# UAN-022 focused overhead and resolved license inventory

Measured 2026-10-03 on research macOS arm64, Node 24.18.0, from isolated source commit `84a5e479f51177a1321630b3955c6bfb93f2e169`. This is package evidence for the private `0.0.0` candidate, not an npmjs installation or release certification. A normal `npm pack --json` ran `prepack` and built the declared exports. The resulting tarball was 135,833 bytes. All consumers below installed that tarball with `npm install --ignore-scripts --no-audit --no-fund`.

## Cold-process invocation and browser bundles

| Observation | Samples / scope | Result |
| --- | --- | --- |
| `runDoctor` with one required passing fixture check | 12 separate Node processes from a packed core consumer | min 22.608 ms; median 23.446 ms; max 24.685 ms |
| Application-owned local CLI fixture, `greet --mode local --name Timing` | 12 separate Node processes from the same packed consumer | min 25.981 ms; median 27.482 ms; max 30.809 ms |
| Synthetic Vite client retaining `createBrowserCapabilityAdapter(document)` from `/browser` | one production build with selected peer tree | 7,392 JS bytes; 2,772 gzip bytes |
| E06 browser theme example, installed from the same tarball | one production Vite build with Zod 4.6.5 and Vite 8.3.2 | 86,176 JS bytes; 25,532 gzip bytes |

Timing used Python `time.perf_counter()` around each `node` subprocess and checked a successful exit. Every sample started a new Node process, while the host file cache and npm cache were warm. The doctor fixture verified an exit-0 report with one finding; it did not contact a remote host. The CLI used the repository's `test/fixtures/packed-cli-smoke.mjs`, including process startup and local execution. The synthetic bundle used `vite build` and assigned the adapter to `window` to prevent tree shaking. Gzip counts use level 9 with a zero timestamp. The synthetic bundle contained no MCP server SDK string. These are observed macOS measurements, not cross-platform performance budgets.

## Installed dependency and license metadata

The core/browser consumer manifest depended only on the tarball. Its installed runtime tree contained one package, `@uppercut-labs/agent-native@0.0.0`, whose package metadata declares MIT. No optional peers were installed.

The selected-integration consumer explicitly depended on the same tarball plus `@modelcontextprotocol/server@2.3.0`, `@modelcontextprotocol/ext-apps@2.0.3`, `astro@7.3.5`, and `zod@4.6.5`. Its resolved lockfile had 303 package paths; 204 package paths were physically installed on this macOS arm64 host and 99 platform-specific or otherwise omitted paths had no installed package manifest. The 204 installed paths represented 204 distinct name/version pairs. Every installed package manifest supplied a license value. Counts by the installed package manifests: Apache-2.0: 8, BSD-2-Clause: 8, BSD-3-Clause: 3, BlueOak-1.0.0: 3, CC0-1.0: 2, ISC: 10, LGPL-3.0-or-later: 1, MIT: 166, MPL-2.0: 2, Python-2.0: 1.

The full inventory below records installed package names, versions and package-manifest license metadata; it does not examine license text, notices, bundled binaries, patent terms, or redistribution obligations. In particular, the installed tree includes `@img/sharp-libvips-darwin-arm64@1.3.4` (LGPL-3.0-or-later), `lightningcss@1.33.0` and `lightningcss-darwin-arm64@1.33.0` (MPL-2.0), and `argparse@2.0.1` (Python-2.0). Legal/notice review and inventory on Windows/Linux remain release qualifications for applications selecting these optional integrations. License metadata can change when the consumer resolves newer transitive versions.

To reproduce the scope: pack this commit normally; create fresh npm projects with the dependency sets above; run `npm install --ignore-scripts --no-audit --no-fund`; compare each `package-lock.json` entry to a physically installed `node_modules/<entry>/package.json` and read that manifest's `name`, `version` and `license`. The browser client entrypoint is bundled from `import { createBrowserCapabilityAdapter } from '@uppercut-labs/agent-native/browser'`. The E06 result comes from its project `npm run build` with the packed tarball substituted for its local package dependency. No full root test suite was repeated for this evidence.

## Resolved installed inventory

| Package | Version | Manifest license |
| --- | --- | --- |
| `@astrojs/compiler-binding` | 0.5.1 | MIT |
| `@astrojs/compiler-binding-darwin-arm64` | 0.5.1 | MIT |
| `@astrojs/compiler-rs` | 0.5.1 | MIT |
| `@astrojs/internal-helpers` | 0.11.0 | MIT |
| `@astrojs/markdown-satteri` | 0.4.2 | MIT |
| `@astrojs/prism` | 4.0.2 | MIT |
| `@astrojs/telemetry` | 3.3.3 | MIT |
| `@babel/helper-string-parser` | 7.29.7 | MIT |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT |
| `@babel/parser` | 7.29.9 | MIT |
| `@babel/types` | 7.29.8 | MIT |
| `@bruits/satteri-darwin-arm64` | 0.10.5 | MIT |
| `@capsizecss/unpack` | 4.0.1 | MIT |
| `@clack/core` | 1.5.1 | MIT |
| `@clack/prompts` | 1.8.1 | MIT |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT |
| `@img/colour` | 1.1.0 | MIT |
| `@img/sharp-darwin-arm64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT |
| `@modelcontextprotocol/client` | 2.3.0 | Apache-2.0 |
| `@modelcontextprotocol/core` | 2.3.0 | Apache-2.0 |
| `@modelcontextprotocol/ext-apps` | 2.0.3 | MIT |
| `@modelcontextprotocol/server` | 2.3.0 | Apache-2.0 |
| `@oslojs/encoding` | 1.1.0 | MIT |
| `@oxc-project/types` | 0.152.0 | MIT |
| `@rolldown/binding-darwin-arm64` | 1.2.12 | MIT |
| `@rolldown/pluginutils` | 1.0.1 | MIT |
| `@shikijs/core` | 4.5.0 | MIT |
| `@shikijs/engine-javascript` | 4.5.0 | MIT |
| `@shikijs/engine-oniguruma` | 4.5.0 | MIT |
| `@shikijs/langs` | 4.5.0 | MIT |
| `@shikijs/primitive` | 4.5.0 | MIT |
| `@shikijs/themes` | 4.5.0 | MIT |
| `@shikijs/types` | 4.5.0 | MIT |
| `@shikijs/vscode-textmate` | 10.0.2 | MIT |
| `@standard-schema/spec` | 1.1.0 | MIT |
| `@types/estree` | 1.0.9 | MIT |
| `@types/estree-jsx` | 1.0.5 | MIT |
| `@types/hast` | 3.0.5 | MIT |
| `@types/mdast` | 4.0.4 | MIT |
| `@types/nlcst` | 2.0.3 | MIT |
| `@types/unist` | 3.0.3 | MIT |
| `@ungap/structured-clone` | 1.4.0 | ISC |
| `@uppercut-labs/agent-native` | 0.0.0 | MIT |
| `am-i-vibing` | 0.4.0 | MIT |
| `anymatch` | 3.1.3 | ISC |
| `argparse` | 2.0.1 | Python-2.0 |
| `aria-query` | 5.3.2 | Apache-2.0 |
| `astro` | 7.3.5 | MIT |
| `axobject-query` | 4.1.0 | Apache-2.0 |
| `bail` | 2.0.2 | MIT |
| `boolbase` | 1.0.0 | ISC |
| `ccount` | 2.0.1 | MIT |
| `character-entities-html4` | 2.1.0 | MIT |
| `character-entities-legacy` | 3.0.0 | MIT |
| `chokidar` | 5.0.0 | MIT |
| `ci-info` | 4.4.0 | MIT |
| `clsx` | 2.1.1 | MIT |
| `comma-separated-tokens` | 2.0.3 | MIT |
| `commander` | 11.1.0 | MIT |
| `common-ancestor-path` | 2.0.0 | BlueOak-1.0.0 |
| `cookie` | 2.0.1 | MIT |
| `cookie-es` | 1.2.3 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `crossws` | 0.3.5 | MIT |
| `css-select` | 6.0.0 | BSD-2-Clause |
| `css-tree` | 2.2.1 | MIT |
| `css-tree` | 3.2.1 | MIT |
| `css-what` | 7.0.0 | BSD-2-Clause |
| `csso` | 5.0.5 | MIT |
| `defu` | 6.1.7 | MIT |
| `dequal` | 2.0.3 | MIT |
| `destr` | 2.0.5 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `devalue` | 5.9.4 | MIT |
| `devlop` | 1.1.0 | MIT |
| `diff` | 9.0.0 | BSD-3-Clause |
| `dom-serializer` | 2.0.0 | MIT |
| `domelementtype` | 2.3.0 | BSD-2-Clause |
| `domhandler` | 5.0.3 | BSD-2-Clause |
| `domutils` | 3.2.2 | BSD-2-Clause |
| `dset` | 3.1.4 | MIT |
| `entities` | 4.5.0 | BSD-2-Clause |
| `es-module-lexer` | 2.3.2 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `eventemitter3` | 5.0.4 | MIT |
| `eventsource` | 3.0.7 | MIT |
| `eventsource-parser` | 3.1.1 | MIT |
| `extend` | 3.0.2 | MIT |
| `fast-string-truncated-width` | 3.0.3 | MIT |
| `fast-string-width` | 3.0.2 | MIT |
| `fast-wrap-ansi` | 0.2.2 | MIT |
| `fdir` | 6.5.0 | MIT |
| `find-proc` | 0.2.0 | MIT |
| `flattie` | 1.1.1 | MIT |
| `fontace` | 0.4.1 | MIT |
| `fontkitten` | 1.0.3 | MIT |
| `fsevents` | 2.3.3 | MIT |
| `get-tsconfig` | 5.0.0-beta.4 | MIT |
| `github-slugger` | 2.0.0 | ISC |
| `h3` | 1.15.11 | MIT |
| `hast-util-to-html` | 9.0.5 | MIT |
| `hast-util-whitespace` | 3.0.0 | MIT |
| `html-escaper` | 3.0.3 | MIT |
| `html-void-elements` | 3.0.0 | MIT |
| `http-cache-semantics` | 4.2.0 | BSD-2-Clause |
| `iron-webcrypto` | 1.2.1 | MIT |
| `is-docker` | 4.0.0 | MIT |
| `is-plain-obj` | 4.1.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `jose` | 6.2.12 | MIT |
| `js-yaml` | 4.3.2 | MIT |
| `jsonc-parser` | 3.3.1 | MIT |
| `lightningcss` | 1.33.0 | MPL-2.0 |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 |
| `magic-string` | 1.4.2 | MIT |
| `magicast` | 0.5.5 | MIT |
| `mdast-util-to-hast` | 13.2.1 | MIT |
| `mdn-data` | 2.0.28 | CC0-1.0 |
| `mdn-data` | 2.27.1 | CC0-1.0 |
| `micromark-util-character` | 2.1.1 | MIT |
| `micromark-util-encode` | 2.0.1 | MIT |
| `micromark-util-sanitize-uri` | 2.0.1 | MIT |
| `micromark-util-symbol` | 2.0.1 | MIT |
| `micromark-util-types` | 2.0.3 | MIT |
| `mrmime` | 2.0.1 | MIT |
| `nanoid` | 3.3.19 | MIT |
| `neotraverse` | 1.0.1 | MIT |
| `nlcst-to-string` | 4.0.0 | MIT |
| `node-fetch-native` | 1.6.7 | MIT |
| `node-mock-http` | 1.0.5 | MIT |
| `normalize-path` | 3.0.0 | MIT |
| `nth-check` | 2.1.1 | BSD-2-Clause |
| `obug` | 3.0.0 | MIT |
| `ofetch` | 1.5.1 | MIT |
| `ohash` | 2.0.12 | MIT |
| `oniguruma-parser` | 0.12.2 | MIT |
| `oniguruma-to-es` | 4.3.6 | MIT |
| `p-limit` | 7.3.3 | MIT |
| `p-queue` | 9.3.3 | MIT |
| `p-timeout` | 7.0.2 | MIT |
| `package-manager-detector` | 1.8.0 | MIT |
| `path-key` | 3.1.1 | MIT |
| `piccolore` | 0.1.3 | ISC |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 2.3.2 | MIT |
| `picomatch` | 4.0.7 | MIT |
| `pkce-challenge` | 5.0.1 | MIT |
| `postcss` | 8.5.28 | MIT |
| `prismjs` | 1.30.0 | MIT |
| `process-ancestry` | 0.1.0 | MIT |
| `property-information` | 7.2.0 | MIT |
| `radix3` | 1.1.2 | MIT |
| `readdirp` | 5.1.1 | MIT |
| `regex` | 6.1.0 | MIT |
| `regex-recursion` | 6.0.2 | MIT |
| `regex-utilities` | 2.3.0 | MIT |
| `resolve-pkg-maps` | 1.0.0 | MIT |
| `retext-smartypants` | 6.2.0 | MIT |
| `rolldown` | 1.2.12 | MIT |
| `satteri` | 0.10.5 | MIT |
| `sax` | 1.6.1 | BlueOak-1.0.0 |
| `semver` | 7.8.5 | ISC |
| `sharp` | 0.35.5 | Apache-2.0 |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `shiki` | 4.5.0 | MIT |
| `sisteransi` | 1.0.5 | MIT |
| `smol-toml` | 1.9.0 | BSD-3-Clause |
| `source-map-js` | 1.2.2 | BSD-3-Clause |
| `space-separated-tokens` | 2.0.2 | MIT |
| `stringify-entities` | 4.0.4 | MIT |
| `svgo` | 4.1.0 | MIT |
| `tiny-inflate` | 1.0.3 | MIT |
| `tinyclip` | 1.0.3 | MIT |
| `tinyexec` | 1.3.1 | MIT |
| `tinyglobby` | 0.2.17 | MIT |
| `trim-lines` | 3.0.1 | MIT |
| `trough` | 2.2.0 | MIT |
| `ufo` | 1.6.4 | MIT |
| `ultrahtml` | 1.7.0 | MIT |
| `uncrypto` | 0.1.3 | MIT |
| `undici` | 8.11.2 | MIT |
| `unified` | 11.0.5 | MIT |
| `unifont` | 0.7.5 | MIT |
| `unist-util-is` | 6.0.1 | MIT |
| `unist-util-position` | 5.0.0 | MIT |
| `unist-util-stringify-position` | 4.0.0 | MIT |
| `unist-util-visit` | 5.1.0 | MIT |
| `unist-util-visit-parents` | 6.0.2 | MIT |
| `unstorage` | 1.17.5 | MIT |
| `verkit` | 0.4.1 | MIT |
| `vfile` | 6.0.3 | MIT |
| `vfile-message` | 4.0.3 | MIT |
| `vite` | 8.3.2 | MIT |
| `vitefu` | 1.1.3 | MIT |
| `which` | 2.0.2 | ISC |
| `xxhash-wasm` | 1.1.0 | MIT |
| `yargs-parser` | 22.0.0 | ISC |
| `yocto-queue` | 1.2.2 | MIT |
| `zod` | 4.6.5 | MIT |
| `zwitch` | 2.0.4 | MIT |
