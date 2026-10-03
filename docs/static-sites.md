# Static sites

Agent Native's Astro integration is an experimental browser bootstrap for static Astro output. It
injects an application-owned browser module through Astro's supported `astro:config:setup`
`injectScript('page', ...)` hook. The hook is Vite-bundled as a page module; the application keeps
ownership of its registry, browser bindings, and user interface.

Astro output must be `static`. The integration checks the final `buildOutput`, emits a diagnostic,
and fails an unsupported server-output build. It does not add an Astro server adapter, SSR route,
sidecar, or hosting configuration. Static builds use Astro's normal default `output: 'static'`
behavior. The feature-detected WebMCP adapter is separate from Astro and is unavailable in hosts
that do not implement the draft API.

For Astro ClientRouter navigation, injected scripts execute once and must resync on
`astro:page-load`; retire page-owned registrations on `astro:before-swap`. The E01 fixture also
resyncs on Window `pageshow` after back-forward cache restoration. Astro's router retains its
normal human-navigation fallback; a missing WebMCP host leaves the page's HTML album search
available and displays a status message.

See [framework support](frameworks.md) and the runnable
[E01 Astro fixture](../examples/e01-album-catalog/project/README.md). The verified Astro version and
build evidence are recorded in [UAN-007 evidence](evidence/UAN-007-astro.md).
