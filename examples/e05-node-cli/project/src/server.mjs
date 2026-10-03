import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { httpHandler, mcpHandler } from './catalog.mjs';

const defaultHostname = '127.0.0.1';

export const app = new Hono();
app.all('/agent-native/*', (context) => httpHandler(context.req.raw));
app.all('/mcp', (context) => mcpHandler(context.req.raw));
app.notFound((context) =>
  context.json({ error: { code: 'not_found', message: 'Not found.' } }, 404),
);
app.onError(() => {
  process.stderr.write('request_error=internal-error\n');
  return new Response(
    JSON.stringify({ error: { code: 'internal_error', message: 'Request failed.' } }),
    {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  );
});

function parsePort(value) {
  const parsed = Number(value ?? '8787');
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new TypeError('invalid-port');
  }
  return parsed;
}

function serverErrorCode(error) {
  if (error && typeof error === 'object' && error.code === 'EADDRINUSE') return 'address-in-use';
  if (error instanceof TypeError && error.message === 'invalid-port') return 'invalid-port';
  return 'listen-failed';
}

export function startServer({ port = 8787, hostname = defaultHostname } = {}) {
  return new Promise((resolve, reject) => {
    let server;
    const onError = (error) => reject(error);
    server = serve(
      {
        fetch: app.fetch,
        hostname,
        port: parsePort(port),
      },
      (info) => {
        server.off('error', onError);
        resolve({
          origin: `http://${hostname}:${info.port}`,
          server,
        });
      },
    );
    server.once('error', onError);
  });
}

export function stopServer(server, graceMs = 500) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main() {
  try {
    const running = await startServer({ port: process.env.PORT });
    process.stderr.write(`listening=${running.origin}\n`);
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      process.stderr.write(`shutdown=${signal}\n`);
      try {
        await stopServer(running.server);
      } catch {
        process.stderr.write('server_error=shutdown-failed\n');
        process.exitCode = 1;
      }
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    process.stderr.write(`server_error=${serverErrorCode(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
