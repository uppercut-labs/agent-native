import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { albumResourceUri, albumToolName, startE09Server } from './server.mjs';

export async function runDemo() {
  const server = await startE09Server();
  const client = new Client({ name: 'e09-text-fallback-demo', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`)));
    const result = await client.callTool({
      name: albumToolName,
      arguments: { slug: 'first-light' },
    });
    console.log(
      JSON.stringify(
        {
          resourceUri: albumResourceUri,
          textFallback: result.content,
          structuredContent: result.structuredContent,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
    await server.close();
  }
}
