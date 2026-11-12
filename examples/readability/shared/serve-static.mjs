import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const mime = {
  '.html': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.jsonld': 'application/ld+json',
  '.js': 'text/javascript',
  '.css': 'text/css',
};
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error('outside-root');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': mime[path.extname(file)] || 'application/octet-stream',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Page not found');
  }
}).listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1');
