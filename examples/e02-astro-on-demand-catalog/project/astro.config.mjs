import node from '@astrojs/node';
import { agentNativeAstro } from '@uppercut-labs/agent-native/astro';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  output: 'static',
  session: false,
  adapter: node({ mode: 'standalone' }),
  integrations: [
    agentNativeAstro({
      browserEntry: fileURLToPath(new URL('./src/browser-entry.mjs', import.meta.url)),
      mode: 'on-demand',
    }),
  ],
});
