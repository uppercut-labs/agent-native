import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import node from '@sveltejs/adapter-node';
import { finalizeWitness } from '../shared/finalize-witness.mjs';

const nodeAdapter = node();
// The Node adapter records each static file's size and precompresses it, so the deployment
// witness gains its client bundle hashes before the adapter packages the client output.
const adapter = {
  ...nodeAdapter,
  async adapt(builder) {
    await finalizeWitness(fileURLToPath(new URL('.', import.meta.url)), 'sveltekit');
    return nodeAdapter.adapt(builder);
  },
};
export default { plugins: [sveltekit({ adapter })] };
