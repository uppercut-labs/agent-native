export function metadata(page) {
  if (!page) return [];
  return [
    { title: page.title },
    ...(page.jsonld ? [{ 'script:ld+json': page.jsonld }] : []),
    { tagName: 'link', rel: 'canonical', href: page.canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: page.mirror },
  ];
}
export function Page({ page, children }) {
  return (
    <main>
      <nav>
        <a href="/guides/getting-started">Public guide</a>
      </nav>
      <h1>{page.title}</h1>
      <p>{page.markdown}</p>
      {page.links?.map((link) => (
        <a key={link.route} href={link.route}>
          {link.title}
        </a>
      ))}
      {children}
    </main>
  );
}
