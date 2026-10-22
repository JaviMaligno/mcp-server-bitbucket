import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

const boundary = vi.hoisted(() => ({
  verify: vi.fn(), forward: vi.fn(), register: vi.fn(), reads: 0,
}));
vi.mock('../src/auth.js', async (original) => ({
  ...await original<typeof import('../src/auth.js')>(),
  getAuthConfig: () => ({ issuer: 'https://issuer.example', audience: 'mcp', resourceUrl: 'https://mcp.example/mcp' }),
  verifyBearer: boundary.verify,
  wwwAuthenticate: () => 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
}));
vi.mock('../src/oauth-proxy.js', async (original) => ({
  ...await original<typeof import('../src/oauth-proxy.js')>(),
  getProxyConfig: () => ({ origin: 'https://mcp.example' }),
  resolveUpstreamEndpoints: async () => ({ token: 'https://issuer.example/token' }),
  forwardTokenRequest: boundary.forward,
  registerClient: boundary.register,
}));
import { createHttpHandler } from '../src/index.js';

async function request(url: string, body: Buffer[], authenticated = true) {
  boundary.verify.mockResolvedValue(authenticated ? { ok: true } : {
    ok: false, status: 401, error: 'invalid_token', description: 'Missing token',
  });
  const req = Readable.from((async function* () {
    for (const chunk of body) { boundary.reads++; yield chunk; }
  })()) as unknown as IncomingMessage;
  Object.assign(req, { method: 'POST', url, headers: {}, socket: { remoteAddress: 'test' } });
  const res = new EventEmitter() as ServerResponse;
  let response = '';
  Object.assign(res, {
    statusCode: 200, setHeader: vi.fn(),
    writeHead(status: number) { res.statusCode = status; return res; },
    end(value = '') { response = value.toString(); res.emit('finish'); return res; },
  });
  await createHttpHandler()(req, res);
  return { status: res.statusCode, body: response };
}

beforeEach(() => { vi.clearAllMocks(); boundary.reads = 0; });
describe('real HTTP handler without a socket or upstream service', () => {
  it('checks authentication before consuming an oversized MCP body', async () => {
    expect((await request('/mcp', [Buffer.alloc(110 * 1024)], false)).status).toBe(401);
    expect(boundary.reads).toBe(0);
  });
  it('bounds malformed MCP bytes before JSON parsing and SDK dispatch', async () => {
    expect((await request('/mcp', [Buffer.alloc(110 * 1024, '!')])).status).toBe(413);
    expect(boundary.verify).toHaveBeenCalledOnce();
  });
  it('does not forward an oversized OAuth token request', async () => {
    expect((await request('/oauth/token', [Buffer.alloc(110 * 1024)])).status).toBe(413);
    expect(boundary.forward).not.toHaveBeenCalled();
  });
  it('does not parse an oversized OAuth registration request', async () => {
    expect((await request('/oauth/register', [Buffer.alloc(110 * 1024, '!')])).status).toBe(413);
    expect(boundary.register).not.toHaveBeenCalled();
  });
  it('preserves OAuth token form bytes and upstream response shape', async () => {
    boundary.forward.mockResolvedValue({ status: 200, contentType: 'application/json', body: '{"access_token":"synthetic"}' });
    const result = await request('/oauth/token', [Buffer.from('code=a%2Bb&'), Buffer.from('grant_type=authorization_code')]);
    expect(result).toEqual({ status: 200, body: '{"access_token":"synthetic"}' });
    expect(boundary.forward).toHaveBeenCalledWith('code=a%2Bb&grant_type=authorization_code', undefined, 'https://issuer.example/token');
  });
});
