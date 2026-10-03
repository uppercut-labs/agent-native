import { createServer } from 'node:http';
import { createHttpHandler } from '@uppercut-labs/agent-native/http';
import { getContent } from './existing/content.mjs';
import { publicReadAuthorization, registry } from './capability.mjs';

const generatedHandler = createHttpHandler(registry, {
  resolveExecutionContext: () => ({
    caller: { kind: 'anonymous' },
    authorization: publicReadAuthorization,
  }),
});

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function sendGenerated(request, response, origin) {
  const generated = await generatedHandler(
    new Request(origin + (request.url ?? '/'), { method: request.method }),
  );
  response.writeHead(generated.status, Object.fromEntries(generated.headers));
  response.end(Buffer.from(await generated.arrayBuffer()));
}

export function createContentServer() {
  return createServer(async (request, response) => {
    const origin = 'http://127.0.0.1';
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/api/content/search') {
      await sendGenerated(request, response, origin);
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    if (url.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    const contentMatch = /^\/api\/content\/([a-z0-9-]+)$/.exec(url.pathname);
    if (contentMatch) {
      const item = getContent(contentMatch[1]);
      sendJson(response, item === null ? 404 : 200, item ?? { error: 'content_not_found' });
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  });
}
