# Nuxt museum collection

This fixture uses Nuxt 4.6.4 with server-side rendering and the Nitro Node server preset. The Nuxt build hook generates the approved publication. The catch-all page resolves a finite public record or returns HTTP 404. English and French pages expose distinct titles, locale, canonical and Markdown URLs. Navigation between translations uses NuxtLink.

Build with `npm ci` and `npm run build`. Run `npm start` with PORT matching SITE_URL. The shared matrix checker exercises the French exhibit, switches to English in Chromium and verifies that the missing French map returns 404. The same project serves the reference field guide.
