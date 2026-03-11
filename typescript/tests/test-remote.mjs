import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.argv[2] || 'http://localhost:3000/mcp';

console.log(`Connecting to ${url}...`);

const client = new Client({ name: 'test-client', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(url));

try {
  await client.connect(transport);
  console.log('Connected!');

  const tools = await client.listTools();
  console.log(`Found ${tools.tools.length} tools:`);
  tools.tools.forEach(t => console.log(`  - ${t.name}`));
} catch (error) {
  console.error('Error:', error.message);
} finally {
  await client.close();
}
