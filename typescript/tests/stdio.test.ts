import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

it('starts the built stdio executable and advertises tools without Bitbucket calls', async () => {
  const client = new Client({ name: 'synthetic-contract', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    env: { BITBUCKET_WORKSPACE: 'synthetic', BITBUCKET_EMAIL: 'test@example.com',
      BITBUCKET_API_TOKEN: 'synthetic-no-provider-call', MCP_TRANSPORT: 'stdio' },
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map(t => t.name)).toContain('list_repositories');
    expect((await client.listPrompts()).prompts.length).toBeGreaterThan(0);
    expect((await client.listResources()).resources.length).toBeGreaterThan(0);
  } finally { await client.close(); }
}, 15_000);
