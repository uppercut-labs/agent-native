import { createServer } from 'node:http';

const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'ok', source: 'e11-local-fixture' }));
});
server.listen(8787, '127.0.0.1', () => {
  process.stdout.write('E11 fixture health: http://127.0.0.1:8787/health\n');
});
