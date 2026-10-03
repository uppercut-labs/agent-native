import './globals.css';

export const metadata = {
  title: 'Margin Notes',
  description: 'A small public reading catalog.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
