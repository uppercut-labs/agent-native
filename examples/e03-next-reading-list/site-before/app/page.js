import catalog from '../public/catalog.json' with { type: 'json' };

export default function HomePage() {
  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Margin Notes home">
          Margin Notes
        </a>
        <p>Reading list / Spring</p>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">A public shelf for slow reading</p>
        <h1 id="page-title">Books worth leaving open on the table.</h1>
        <p className="lede">
          Four books about other worlds, living systems, and the stories we use to find our way
          through both.
        </p>
      </section>

      <section className="catalog" aria-labelledby="catalog-title">
        <div className="section-heading">
          <h2 id="catalog-title">The list</h2>
          <span>{String(catalog.length).padStart(2, '0')} volumes</span>
        </div>
        <ol>
          {catalog.map((book, index) => (
            <li key={book.id}>
              <span className="index">{String(index + 1).padStart(2, '0')}</span>
              <article>
                <div className="book-heading">
                  <h3>{book.title}</h3>
                  <span>{book.year}</span>
                </div>
                <p className="byline">{book.author}</p>
                <p className="note">{book.note}</p>
                <p className="shelf">{book.shelf}</p>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <footer>
        <p>Public sample catalog. Personal lists stay on the server.</p>
        <a href="/api/catalog">Catalog JSON</a>
      </footer>
    </main>
  );
}
