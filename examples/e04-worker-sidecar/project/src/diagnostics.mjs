export function diagnoseSidecar({
  pageOrigin,
  sidecarOrigin,
  sameOriginMcpStatus,
  sidecarHealth,
  browserRevision,
}) {
  if (!sidecarOrigin)
    return {
      kind: 'sidecar-not-configured',
      message: 'No sidecar URL is configured; static catalog still works.',
    };
  let sidecar, page;
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
  )
    return { kind: 'insecure-sidecar-origin', message: 'Use HTTPS for a non-local sidecar.' };
  if (sameOriginMcpStatus === 404 && sidecar.origin !== page.origin)
    return {
      kind: 'same-origin-route-missing',
      message: 'Configure a same-origin /mcp proxy or use the sidecar URL directly.',
    };
  if (sidecarHealth?.code === 'missing_catalog_binding')
    return {
      kind: 'missing-catalog-binding',
      message: 'Set Worker CATALOG_REVISION to the shared catalog revision.',
    };
  if (
    sidecarHealth?.code === 'catalog_revision_mismatch' ||
    (sidecarHealth?.status === 'ok' && sidecarHealth.catalogRevision !== browserRevision)
  )
    return {
      kind: 'catalog-revision-mismatch',
      message: 'Rebuild the static site or sidecar so both use the same revision.',
    };
  if (sidecarHealth?.status !== 'ok')
    return {
      kind: 'sidecar-unavailable',
      message: 'Sidecar health did not return a usable status.',
    };
  if (sidecar.origin !== page.origin)
    return {
      kind: 'sidecar-origin-differs',
      message: 'Use the separate sidecar URL for direct clients or configure host routing.',
    };
  return { kind: 'ready', message: 'Static page and sidecar revisions match.' };
}
