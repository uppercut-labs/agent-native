// What a host without MCP Apps support receives: ordinary tool text and structured content.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createE13Handler, listen, readViews, toolNames } from './server.mjs';

const server = await listen(createE13Handler({ views: await readViews() }));
const client = new Client({ name: 'e13-text-host', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`)));
  const { tools } = await client.listTools();
  console.log(`Anonymous tools: ${tools.map((tool) => tool.name).join(', ')}`);
  const result = await client.callTool({
    name: toolNames['explore.open'],
    arguments: { attempts: 5 },
  });
  console.log(`Text result: ${result.content[0].text}`);
} finally {
  await client.close();
  await server.close();
}
