import { createServer } from 'node:http';
import { httpHandler } from './catalog.mjs';

const port = Number(process.env.PORT ?? '8787');
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, value);
  }
  const request = new Request('http://127.0.0.1' + incoming.url, {
    method: incoming.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  const response = await httpHandler(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, '127.0.0.1', () => {
  process.stderr.write('listening=http://127.0.0.1:' + port + '\n');
});
