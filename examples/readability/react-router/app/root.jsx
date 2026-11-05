import { Links, Meta, Outlet, Scripts, isRouteErrorResponse } from 'react-router';
export function Layout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
export default function App() {
  return <Outlet />;
}
export function ErrorBoundary({ error }) {
  return (
    <main>
      <h1>{isRouteErrorResponse(error) ? error.status : 'Error'}</h1>
      <a href="/guides/getting-started">Public guide</a>
    </main>
  );
}
