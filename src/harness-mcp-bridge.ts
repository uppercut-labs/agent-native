import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type HarnessMcpBridgeOptions = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly host?: '127.0.0.1';
  readonly port?: number;
  readonly maxRequestBytes?: number;
  readonly deadlineMs?: number;
};

export interface HarnessMcpBridge {
  readonly url: string;
  close(): Promise<void>;
}

/** Transport only: the supplied handler retains authentication and capability authorization. */
export async function startHarnessMcpBridge(
  options: HarnessMcpBridgeOptions,
): Promise<HarnessMcpBridge> {
  const host: '127.0.0.1' = options.host ?? '127.0.0.1';
  const port: number = options.port ?? 0;
  const maxRequestBytes: number = options.maxRequestBytes ?? 32_768;
  const deadlineMs: number = options.deadlineMs ?? 30_000;
  if (
    host !== '127.0.0.1' ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535 ||
    !Number.isInteger(maxRequestBytes) ||
    maxRequestBytes < 1 ||
    maxRequestBytes > 1_048_576 ||
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 300_000
  )
    throw new TypeError('Invalid loopback MCP bridge configuration.');

  let origin: string = '';
  let active: Set<AbortController> = new Set();
  let server: Server = createServer(
    async (
      incoming: IncomingMessage,
      outgoing: ServerResponse<IncomingMessage> & { req: IncomingMessage },
    ): Promise<void> => {
      if (incoming.headers.host !== origin.slice('http://'.length)) {
        outgoing.writeHead(421).end();
        return;
      }
      if (incoming.headers.origin !== undefined && incoming.headers.origin !== origin) {
        outgoing.writeHead(403).end();
        return;
      }
      let url: URL;
      try {
        url = new URL(incoming.url ?? '/', origin);
      } catch {
        outgoing.writeHead(400).end();
        return;
      }
      if (url.origin !== origin) {
        outgoing.writeHead(421).end();
        return;
      }
      if (url.pathname !== '/mcp') {
        outgoing.writeHead(404).end();
        return;
      }
      let controller: AbortController = new AbortController();
      active.add(controller);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const disconnected: () => void = (): void => controller.abort();
      outgoing.on('close', disconnected);
      incoming.on('aborted', disconnected);
      const timer: NodeJS.Timeout = setTimeout((): void => {
        controller.abort();
        if (outgoing.headersSent) outgoing.destroy();
        else outgoing.writeHead(504).end();
      }, deadlineMs);
      try {
        let chunks: Buffer[] = [];
        let size: number = 0;
        for await (const chunk of incoming) {
          const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maxRequestBytes) {
            outgoing.writeHead(413).end();
            return;
          }
          chunks.push(bytes);
        }
        if (controller.signal.aborted) return;
        let headers: Headers = new Headers();
        for (let index: number = 0; index < incoming.rawHeaders.length; index += 2) {
          const name: string | undefined = incoming.rawHeaders[index];
          const value: string | undefined = incoming.rawHeaders[index + 1];
          if (name !== undefined && value !== undefined) headers.append(name, value);
        }
        const method: string = incoming.method ?? 'GET';
        const request: Request = new Request(url, {
          method,
          headers,
          signal: controller.signal,
          ...(method === 'GET' || method === 'HEAD'
            ? {}
            : { body: new Uint8Array(Buffer.concat(chunks)) }),
        });
        const response: Response = await options.handler(request);
        if (controller.signal.aborted) {
          await response.body?.cancel();
          return;
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body !== null && method !== 'HEAD') {
          reader = response.body.getReader();
          // Cancellation also interrupts an idle SSE read during close or client disconnect.
          controller.signal.addEventListener(
            'abort',
            (): void => {
              void reader
                ?.cancel()
                .catch((): void => console.error('MCP bridge response cancellation failed.'));
            },
            { once: true },
          );
          while (!controller.signal.aborted) {
            const { value, done }: ReadableStreamReadResult<Uint8Array<ArrayBufferLike>> =
              await reader.read();
            if (done) break;
            if (!outgoing.write(value))
              await once(outgoing, 'drain', { signal: controller.signal });
          }
        } else await response.body?.cancel();
        if (!outgoing.destroyed) outgoing.end();
      } catch {
        if (!controller.signal.aborted) {
          console.error('MCP bridge request failed.');
          if (outgoing.headersSent) outgoing.destroy();
          else outgoing.writeHead(500).end();
        }
      } finally {
        clearTimeout(timer);
        active.delete(controller);
        outgoing.off('close', disconnected);
        incoming.off('aborted', disconnected);
        reader?.releaseLock();
      }
    },
  );
  server.requestTimeout = deadlineMs;
  server.headersTimeout = deadlineMs;
  server.listen(port, host);
  await once(server, 'listening');
  const address: string | AddressInfo | null = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('MCP bridge failed to bind.');
  }
  origin = `http://${host}:${address.port}`;
  let closing: Promise<void> | undefined;
  return Object.freeze({
    url: `${origin}/mcp`,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
        for (const controller of active) controller.abort();
        server.close((error?: Error): void => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  });
}
