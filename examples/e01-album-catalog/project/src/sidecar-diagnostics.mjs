const installations = new WeakMap();

export function diagnoseSidecar({
  pageOrigin,
  sidecarOrigin,
  sameOriginMcpStatus,
  expectedRouteMode = 'sidecar',
  sidecarHealth,
  browserRevision,
}) {
  if (!sidecarOrigin)
    return {
      kind: 'sidecar-not-configured',
      message: 'No sidecar URL is configured; the static catalog still works.',
    };
  let sidecar;
  let page;
  try {
    sidecar = new URL(sidecarOrigin);
    page = new URL(pageOrigin);
  } catch {
    return { kind: 'invalid-sidecar-origin', message: 'Set a valid absolute sidecar URL.' };
  }
  if (
    sidecar.protocol !== 'https:' &&
    sidecar.hostname !== '127.0.0.1' &&
    sidecar.hostname !== 'localhost'
  ) {
    return { kind: 'insecure-sidecar-origin', message: 'Use HTTPS for a non-local sidecar.' };
  }
  if (expectedRouteMode === 'same-origin' && sameOriginMcpStatus === 404) {
    return {
      kind: 'same-origin-route-missing',
      message: 'Configure a same-origin /mcp proxy or use the sidecar URL directly.',
    };
  }
  if (sidecarHealth?.code === 'missing_catalog_binding') {
    return {
      kind: 'missing-catalog-binding',
      message: 'Set Worker CATALOG_REVISION to the shared catalog revision.',
    };
  }
  if (
    sidecarHealth?.code === 'catalog_revision_mismatch' ||
    (sidecarHealth?.status === 'ok' && sidecarHealth.catalogRevision !== browserRevision)
  ) {
    return {
      kind: 'catalog-revision-mismatch',
      message: 'Rebuild the static site or sidecar so both use the same revision.',
    };
  }
  if (sidecarHealth?.status !== 'ok')
    return {
      kind: 'sidecar-unavailable',
      message: 'Sidecar health did not return a usable status.',
    };
  if (sidecar.origin !== page.origin) {
    return {
      kind: 'sidecar-origin-differs',
      message: 'Use the separate sidecar URL for direct clients or configure host routing.',
    };
  }
  return { kind: 'ready', message: 'Static page and sidecar revisions match.' };
}

export function installSidecarDiagnostics(
  document,
  { pageOrigin, browserRevision, fetcher = fetch },
) {
  const existing = installations.get(document);
  if (existing !== undefined) return existing;
  let pending = Promise.resolve();

  async function refresh() {
    const section = document.querySelector('[data-album-catalog]');
    const status = document.querySelector('[data-sidecar-status]');
    if (section === null || status === null) return;
    const sidecarOrigin = section.getAttribute('data-sidecar-origin') ?? '';
    const expectedRouteMode = section.getAttribute('data-route-mode') ?? 'sidecar';
    let sidecarHealth;
    let sameOriginMcpStatus;
    if (sidecarOrigin !== '') {
      try {
        const healthResponse = await fetcher(new URL('/health', sidecarOrigin));
        sidecarHealth = await healthResponse.json();
      } catch {
        sidecarHealth = { status: 'unavailable' };
      }
      if (expectedRouteMode === 'same-origin') {
        try {
          sameOriginMcpStatus = (await fetcher(new URL('/mcp', pageOrigin))).status;
        } catch {
          sameOriginMcpStatus = undefined;
        }
      }
    }
    const report = diagnoseSidecar({
      pageOrigin,
      sidecarOrigin,
      sameOriginMcpStatus,
      expectedRouteMode,
      sidecarHealth,
      browserRevision,
    });
    status.textContent = report.message + ' Browser revision: ' + browserRevision + '.';
  }

  const onPageLoad = () => {
    pending = refresh();
  };
  const onPageShow = () => {
    pending = refresh();
  };
  document.addEventListener('astro:page-load', onPageLoad);
  document.defaultView?.addEventListener('pageshow', onPageShow);
  const installation = {
    whenReady: () => pending,
    dispose() {
      document.removeEventListener('astro:page-load', onPageLoad);
      document.defaultView?.removeEventListener('pageshow', onPageShow);
      installations.delete(document);
    },
  };
  installations.set(document, installation);
  pending = refresh();
  return installation;
}
