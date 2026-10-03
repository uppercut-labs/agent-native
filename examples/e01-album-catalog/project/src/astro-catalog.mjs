const installations = new WeakMap();

export function installAstroCatalog(
  document,
  { registry, createAdapter, lookup, onStatus = () => {} },
) {
  const existing = installations.get(document);
  if (existing !== undefined) return existing;

  let adapter;
  let pending = Promise.resolve();

  function retireAdapter() {
    adapter?.dispose();
    adapter = undefined;
  }

  async function refresh() {
    if (document.querySelector('[data-album-catalog]') === null) {
      retireAdapter();
      return;
    }

    adapter ??= createAdapter(document);
    try {
      const report = await adapter.sync(registry);
      onStatus(
        report.supported
          ? 'Browser agent tools are available for this page.'
          : 'Agent tools are unavailable in this browser. You can still search the catalog below.',
      );
    } catch {
      onStatus('Agent tools are unavailable. You can still search the catalog below.');
    }
  }

  function onPageLoad() {
    pending = refresh();
  }

  function onBeforeSwap() {
    retireAdapter();
  }

  function onPageShow() {
    retireAdapter();
    pending = refresh();
  }

  function onSubmit(event) {
    const form = event.target;
    if (form?.matches?.('form[data-album-lookup]') !== true) return;
    event.preventDefault();

    const slug = form.querySelector('input[name="slug"]')?.value;
    if (typeof slug !== 'string') return;

    void Promise.resolve(lookup({ slug })).then((result) => {
      const output = form.querySelector('[data-lookup-result]');
      if (output !== null) {
        output.textContent =
          result.kind === 'success' ? JSON.stringify(result.value) : 'No matching album.';
      }
    });
  }

  document.addEventListener('astro:page-load', onPageLoad);
  document.addEventListener('astro:before-swap', onBeforeSwap);
  document.addEventListener('submit', onSubmit);
  document.defaultView?.addEventListener('pageshow', onPageShow);

  const installation = {
    whenReady: () => pending,
    dispose() {
      document.removeEventListener('astro:page-load', onPageLoad);
      document.removeEventListener('astro:before-swap', onBeforeSwap);
      document.removeEventListener('submit', onSubmit);
      document.defaultView?.removeEventListener('pageshow', onPageShow);
      retireAdapter();
      installations.delete(document);
    },
  };
  installations.set(document, installation);
  pending = refresh();
  return installation;
}
