import { createServer } from 'node:http';
import { getContent, searchContent } from './content.mjs';

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

export function createContentServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const isSearch = url.pathname === '/api/content/search';
    const isHealth = url.pathname === '/api/health';
    const contentMatch = /^\/api\/content\/([a-z0-9-]+)$/.exec(url.pathname);

    if (request.method !== 'GET') {
      if (isSearch || isHealth || contentMatch) {
        sendJson(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
      } else {
        sendJson(response, 404, { error: 'not_found' });
      }
      return;
    }

    if (isHealth) {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (isSearch) {
      try {
        const limit = url.searchParams.has('limit')
          ? Number(url.searchParams.get('limit'))
          : 5;
        sendJson(response, 200, searchContent({
          query: url.searchParams.get('q'),
          limit,
        }));
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          sendJson(response, 400, { error: 'invalid_search', message: error.message });
          return;
        }
        throw error;
      }
      return;
    }

    if (contentMatch) {
      const item = getContent(contentMatch[1]);
      if (item) {
        sendJson(response, 200, item);
      } else {
        sendJson(response, 404, { error: 'content_not_found' });
      }
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  });
}
