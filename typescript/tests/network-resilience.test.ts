/** SPEC-4: actual incomplete HTTP bodies and MCP process survival. */
import axios, { type AxiosError } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BitbucketClient } from '../src/client.js';
import { resetSettings } from '../src/settings.js';

vi.mock('../src/utils.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils.js')>(), sleep: vi.fn(async () => undefined),
}));

let server: Server | undefined;

function abortBody(response: ServerResponse): void {
  response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
  response.flushHeaders();
  response.write('{"incomplete":');
  setTimeout(() => response.destroy(), 20);
}

async function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(() => {
  vi.stubEnv('BITBUCKET_WORKSPACE', 'synthetic');
  vi.stubEnv('BITBUCKET_EMAIL', 'test@example.com');
  vi.stubEnv('BITBUCKET_API_TOKEN', 'synthetic-no-provider-call');
  vi.stubEnv('MAX_RETRIES', '1');
  resetSettings();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetSettings();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
});

it.each(['json', 'text'])('retries actual aborted %s GET response bodies, but never repeats an aborted write', async format => {
  let reads = 0;
  let writes = 0;
  const observed: AxiosError[] = [];
  const url = await listen((request, response) => {
    if (request.method === 'POST') { writes++; abortBody(response); }
    else if (++reads === 1) abortBody(response);
    else { response.setHeader('Content-Type', 'application/json'); response.end('{"name":"recovered"}'); }
  });
  const originalCreate = axios.create.bind(axios);
  vi.spyOn(axios, 'create').mockImplementation(config => {
    const instance = originalCreate({ ...config, baseURL: url, proxy: false });
    instance.interceptors.response.use(undefined, error => { observed.push(error); return Promise.reject(error); });
    return instance;
  });
  const client = new BitbucketClient();
  if (format === 'json') expect(await client.getRepository('repo')).toMatchObject({ name: 'recovered' });
  else expect(await client.getCommitDiff('repo', 'base', 'head')).toBe('{"name":"recovered"}');
  expect(reads).toBe(2);
  expect(observed[0].code).toBe('ERR_BAD_RESPONSE');
  expect(observed[0].message).toBe('stream has been aborted');
  expect(observed[0].response?.status).toBe(200);
  await expect(client.createTag('repo', 'v1', 'main')).rejects.toThrow(/Network/);
  expect(writes).toBe(1);
}, 10_000);

it('reports exhausted HTTP disconnects, then completes a tool call in the same stdio subprocess', async () => {
  let calls = 0;
  const url = await listen((_request, response) => {
    if (++calls <= 2) abortBody(response);
    else { response.setHeader('Content-Type', 'application/json'); response.end('{"values":[{"hash":"recovered","message":"ok"}]}'); }
  });
  const directory = await mkdtemp(join(tmpdir(), 'bitbucket-stdio-recovery-'));
  const preloader = join(directory, 'loopback.mjs');
  const axiosModule = pathToFileURL(fileURLToPath(new URL('../node_modules/axios/index.js', import.meta.url))).href;
  await writeFile(preloader, `import axios from ${JSON.stringify(axiosModule)};\nconst create = axios.create.bind(axios);\naxios.create = config => create({...config, baseURL:${JSON.stringify(url)}, proxy:false});\n`);
  const client = new Client({ name: 'synthetic-recovery', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', preloader, fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    env: { BITBUCKET_WORKSPACE: 'synthetic', BITBUCKET_EMAIL: 'test@example.com', BITBUCKET_API_TOKEN: 'synthetic-no-provider-call',
      MAX_RETRIES: '1', API_TIMEOUT: '5', MCP_TRANSPORT: 'stdio' },
  });
  try {
    await client.connect(transport);
    const failed = await client.callTool({ name: 'list_commits', arguments: { repo_slug: 'repo' } });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed.content)).toContain('Network request failed after 2 attempt(s)');
    expect(calls).toBe(2);
    const succeeded = await client.callTool({ name: 'list_commits', arguments: { repo_slug: 'repo' } });
    expect(succeeded.isError).not.toBe(true);
    expect(JSON.stringify(succeeded.content)).toContain('recover');
    expect(calls).toBe(3);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
