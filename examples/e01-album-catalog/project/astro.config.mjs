import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { agentNativeAstro } from '@uppercut-labs/agent-native/astro';

export default defineConfig({
  output: 'static',
  integrations: [
    agentNativeAstro({
      browserEntry: fileURLToPath(new URL('./src/album-browser-entry.mjs', import.meta.url)),
    }),
  ],
});
