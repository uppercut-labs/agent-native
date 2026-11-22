import model from '../generated/publication.json';
export default function Directory() {
  return (
    <main>
      <h1>Course directory</h1>
      <ul>
        {model.pages.map((page) => (
          <li key={page.id}>
            <a href={page.route}>{page.title}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
