import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./dist/browser/', import.meta.url));
const media = {
  '.html': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.jsonld': 'application/ld+json',
  '.js': 'application/javascript',
  '.css': 'text/css',
};
export function makeServer() {
  return createServer(async (req, res) => {
    const finish = (code, message) =>
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    if (req.method !== 'GET' && req.method !== 'HEAD') return finish(405, 'Method unavailable');
    try {
      const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (
        route === '/service' ||
        route.startsWith('/service/') ||
        route === '/account' ||
        route.startsWith('/account/')
      ) {
        return finish(403, 'Access denied');
      }
      let file = path.resolve(root, '.' + route);
      const rel = path.relative(root, file);
      if (
        rel.startsWith('..') ||
        path.isAbsolute(rel) ||
        rel.split(path.sep).some((p) => p.startsWith('.'))
      ) {
        return finish(404, 'Missing');
      }
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type':
          (media[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      finish(404, 'Missing');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeServer().listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1');
}
