import './globals.css';
import { AgentNativeBootstrap } from './agent-native-bootstrap.js';

export const metadata = {
  title: 'Margin Notes',
  description: 'A small public reading catalog.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AgentNativeBootstrap />
      </body>
    </html>
  );
}
