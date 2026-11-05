// Route changes update the same metadata as a direct, cold HTTP request.
export function setPageHead(page) {
  document.title = page?.title ?? 'Port Almanac';
  for (const node of document.querySelectorAll(
    'link[rel=canonical], link[rel=alternate][type="text/markdown"], script[type="application/ld+json"]',
  ))
    node.remove();
  if (!page) return;
  for (const [rel, href, type] of [
    ['canonical', page.canonical, ''],
    ['alternate', page.mirror, 'text/markdown'],
  ]) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    if (type) link.type = type;
    document.head.append(link);
  }
  if (page.jsonld) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(page.jsonld);
    document.head.append(script);
  }
}
