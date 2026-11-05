/** Credentials must survive Bitbucket's same-host redirects (e.g. PR diff -> /diff/...). */
import axios from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { BitbucketClient } from '../src/client.js';
import { resetSettings } from '../src/settings.js';

let server: Server | undefined;

beforeEach(() => {
  vi.stubEnv('BITBUCKET_WORKSPACE', 'synthetic');
  vi.stubEnv('MAX_RETRIES', '0');
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

it.each([
  ['basic', { BITBUCKET_EMAIL: 'test@example.com', BITBUCKET_API_TOKEN: 'synthetic-token' },
    `Basic ${Buffer.from('test@example.com:synthetic-token').toString('base64')}`],
  ['bearer', { BITBUCKET_OAUTH_TOKEN: 'synthetic-access-token' }, 'Bearer synthetic-access-token'],
])('keeps %s credentials when following a same-host redirect', async (_mode, env, expected) => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetSettings();
  const seen: Array<string | undefined> = [];
  server = createServer((request, response) => {
    seen.push(request.headers.authorization);
    if (request.headers.authorization !== expected) { response.writeHead(404); response.end(); return; }
    if (request.url?.includes('/pullrequests/7/diff')) {
      response.writeHead(302, { Location: '/repositories/synthetic/repo/diff/synthetic/repo:aaa%0Dbbb?from_pullrequest_id=7' });
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'text/plain');
    response.end('diff --git a/x b/x\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  const url = `http://127.0.0.1:${address.port}`;
  const originalCreate = axios.create.bind(axios);
  vi.spyOn(axios, 'create').mockImplementation(config => originalCreate({ ...config, baseURL: url, proxy: false }));

  expect(await new BitbucketClient().getPrDiff('repo', 7)).toBe('diff --git a/x b/x\n');
  expect(seen).toEqual([expected, expected]);
});
