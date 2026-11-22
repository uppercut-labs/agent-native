import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { setPageHead } from '../../shared/browser.mjs';
import model from '../generated/publication.json';

function Catalog() {
  const [queue, setQueue] = useState([]);
  const { pathname } = useLocation();
  const page = model.pages.find((entry) => entry.route === pathname.replace(/\/$/, ''));
  useEffect(() => setPageHead(page), [page]);
  return (
    <main>
      <nav>
        <Link to="/">Catalog</Link> · <Link to="/guides/getting-started">Field guide</Link>
      </nav>
      {page ? (
        <article>
          <h1>{page.title}</h1>
          <p>{page.markdown}</p>
          {page.facts?.length > 0 && (
            <section aria-label="Key facts">
              <h2>Key facts</h2>
              <ul>
                {page.facts.map((fact) => (
                  <li key={fact.label}>
                    {fact.label}: {fact.value}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {page.links.map((link) => (
            <p key={link.route}>
              <Link to={link.route}>{link.title}</Link>
            </p>
          ))}
          {page.id === 'night-ferry' && (
            <button type="button" onClick={() => setQueue([...queue, page.title])}>
              Add to queue
            </button>
          )}
        </article>
      ) : (
        <>
          <h1>Record catalog</h1>
          {model.pages.map((entry) => (
            <p key={entry.id}>
              <Link to={entry.route}>{entry.title}</Link>
            </p>
          ))}
        </>
      )}
      <p aria-live="polite">Playback queue: {queue.length ? queue.join(', ') : 'Empty'}</p>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/tracks/:track" element={<Catalog />} />
        <Route path="/guides/:guide" element={<Catalog />} />
        <Route path="*" element={<h1>Page not found</h1>} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('app')).render(<App />);
