export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Course directory</a> · <a href="/guides/getting-started">Field guide</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
