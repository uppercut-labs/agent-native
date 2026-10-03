import { App } from '@modelcontextprotocol/ext-apps';
import { createAlbumExplorerController } from './view-controller.mjs';
import { albumOutput } from './output-schema.mjs';

const status = document.querySelector('#status');
const slugInput = document.querySelector('#slug');
const form = document.querySelector('#lookup-form');
const toolName = 'cap_15_example.catalog_12_album.lookup_v1';

function render(state) {
  if (state.kind === 'loading') {
    status.textContent = `Looking up ${state.slug}…`;
  } else if (state.kind === 'found') {
    status.textContent = `${state.album.title} (${state.album.slug})`;
  } else if (state.kind === 'missing') {
    status.textContent = 'No sample album has that slug.';
  } else if (state.kind === 'denied') {
    status.textContent = state.message ?? 'The host denied this request.';
  } else {
    status.textContent = state.message ?? 'Album data is unavailable.';
  }
}

const app = new App({ name: 'Uppercut Album Explorer', version: '1.0.0' }, {});
const explorer = createAlbumExplorerController({
  app,
  toolName,
  outputSchema: albumOutput,
  render,
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void explorer.lookup(slugInput.value.trim());
});
app
  .connect()
  .catch(() => render({ kind: 'unavailable', message: 'This host does not support MCP Apps.' }));
