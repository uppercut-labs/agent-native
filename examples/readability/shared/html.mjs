const escapeText = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function documentFor(template, page) {
  const head = [
    `<title>${escapeText(page.title)}</title>`,
    `<link rel="canonical" href="${escapeText(page.canonical)}">`,
    `<link rel="alternate" type="text/markdown" href="${escapeText(page.mirror)}">`,
    page.jsonld
      ? `<script type="application/ld+json">${JSON.stringify(page.jsonld).replaceAll('<', '\\u003c')}</script>`
      : '',
  ].join('\n');
  const links = page.links
    .map(({ route, title }) => `<a href="${escapeText(route)}">${escapeText(title)}</a>`)
    .join(' ');
  const content = `<main><h1>${escapeText(page.title)}</h1><p>${escapeText(page.markdown)}</p>${links}</main>`;
  return template.replace('<!--page-head-->', head).replace('<!--page-body-->', content);
}

// File-first hosts can serve cold deep links and facts even when JavaScript is unavailable.
export function pageOutputs(model) {
  return {
    name: 'approved-route-html',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const template = bundle['index.html']?.source;
        if (typeof template !== 'string') throw new Error('Missing Vite HTML entry');
        for (const page of model.pages) {
          this.emitFile({
            type: 'asset',
            fileName: page.route.slice(1) + '/index.html',
            source: documentFor(template, page),
          });
        }
        bundle['index.html'].source = template
          .replace('<!--page-head-->', '<title>Port Almanac</title>')
          .replace(
            '<!--page-body-->',
            model.pages
              .map(
                (page) =>
                  `<p><a href="${escapeText(page.route)}">${escapeText(page.title)}</a></p>`,
              )
              .join(''),
          );
      },
    },
  };
}
