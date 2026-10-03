import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  turbopack: {
    root: fixtureRoot,
  },
};

export default nextConfig;
