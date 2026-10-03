import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  session: false,
  adapter: node({
    mode: 'standalone',
  }),
});
