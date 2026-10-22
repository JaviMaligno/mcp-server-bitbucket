import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { parseMcpBody, readHttpBody } from '../src/http-input.js';

describe('HTTP input bounds before OAuth forwarding and SDK validation', () => {
  it('preserves byte-exact OAuth form bodies across chunks', async () => {
    const input = ['grant_type=refresh_token&', 'refresh_token=a%2Bb&scope=mcp'];
    expect((await readHttpBody(Readable.from(input.map(x => Buffer.from(x))))).toString())
      .toBe(input.join(''));
  });

  it('stops consuming chunked bodies above 100 KiB', async () => {
    let consumed = 0;
    async function* chunks() {
      for (let i = 0; i < 5; i++) { consumed++; yield Buffer.alloc(40 * 1024); }
    }
    await expect(readHttpBody(chunks())).rejects.toMatchObject({ status: 413 });
    expect(consumed).toBe(3);
  });

  it('accepts a normal single MCP request without changing its arguments', () => {
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'list_repositories', arguments: { limit: 5 },
    } };
    expect(parseMcpBody(Buffer.from(JSON.stringify(request)))).toEqual(request);
  });

  it('rejects a request with excessive nested tool-input elements before SDK dispatch', () => {
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'create_pull_request', arguments: { reviewers: Array.from({ length: 1001 }, () => ({})) },
    } };
    expect(() => parseMcpBody(Buffer.from(JSON.stringify(request))))
      .toThrow(/elements/);
  });

  it('rejects a JSON-RPC batch before dispatch', () => {
    expect(() => parseMcpBody(Buffer.from('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')))
      .toThrow(/batch/i);
  });
});
