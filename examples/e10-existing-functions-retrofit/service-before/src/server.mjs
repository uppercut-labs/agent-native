import { createContentServer } from './http.mjs';

const rawPort = process.env.PORT ?? '8788';
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write('PORT must be an integer from 0 to 65535\n');
  process.exitCode = 2;
} else {
  const server = createContentServer();
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    process.stderr.write('listening=http://127.0.0.1:' + address.port + '\n');
  });
}
