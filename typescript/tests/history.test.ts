/** SPEC-2/3/4: resumable history, Git diff semantics and bounded recovery. */
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitbucketClient, BitbucketError, resetClient } from '../src/client.js';
import { resetSettings } from '../src/settings.js';
import { handlers as commitTools } from '../src/tools/commits.js';
import { handlers as sourceTools } from '../src/tools/source.js';

vi.mock('../src/utils.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils.js')>(),
  sleep: vi.fn(async () => undefined),
}));

const ROOT = 'https://api.bitbucket.org/2.0/repositories/test-workspace/repo';
type Reply = { status?: number; data?: unknown; headers?: Record<string, string>; code?: string; message?: string };
let calls: InternalAxiosRequestConfig[];
let replies: Reply[];
const adapter: AxiosAdapter = async (config) => {
  calls.push(config);
  const reply = replies.shift() ?? { data: { values: [] } };
  if (reply.code) throw new AxiosError(reply.message ?? 'network failure', reply.code, config);
  const response = { status: reply.status ?? 200, data: reply.data, headers: reply.headers ?? {}, config, statusText: '' };
  if (response.status >= 400) throw new AxiosError('request failed', undefined, config, undefined, response);
  return response;
};

beforeEach(() => {
  vi.stubEnv('BITBUCKET_WORKSPACE', 'test-workspace');
  vi.stubEnv('BITBUCKET_EMAIL', 'test@example.com');
  vi.stubEnv('BITBUCKET_API_TOKEN', 'test-token');
  vi.stubEnv('MAX_RETRIES', '2');
  resetSettings();
  resetClient();
  calls = [];
  replies = [];
  axios.defaults.adapter = adapter;
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('SPEC-2 resumable history', () => {
  it('reports missing history instead of silently claiming an empty complete result, then remains usable', async () => {
    replies = [{ status: 404 }, { data: { values: [{ hash: 'ok' }] } }, { status: 404 }];
    await expect(commitTools.list_commits({ repo_slug: 'repo' })).rejects.toThrow(/not found.*404/i);
    expect(await commitTools.list_commits({ repo_slug: 'repo' })).toMatchObject({ commits: [{ hash: 'ok' }], has_more: false });
    expect(await new BitbucketClient().listCommits('repo')).toEqual([]);
  });

  it('reaches old commits and retains cursor page size without dropping entries', async () => {
    const next = ROOT + '/commits?cursor=old&pagelen=2';
    replies = [{ data: { values: [{ hash: 'new' }], next } }, { data: { values: [{ hash: 'old1' }, { hash: 'old2' }] } }];
    const client = new BitbucketClient();
    const first = await client.listCommitsPage('repo', { limit: 2 });
    expect(first).toMatchObject({ has_more: true, next_cursor: next });
    const second = await client.listCommitsPage('repo', { cursor: first.next_cursor!, limit: 1 });
    expect(second.values).toHaveLength(2);
    expect(second.has_more).toBe(false);
    expect(calls[1].url).toBe(next);
    expect(calls[1].params).toBeUndefined();
  });

  it.each([
    'https://evil.example/commits', ROOT.replace('https:', 'http:') + '/commits',
    ROOT + '/refs/tags?page=2', ROOT.replace('https://', 'https://user:pass@') + '/commits',
    ROOT + '/commits#fragment', ROOT.replace('api.bitbucket.org', 'api.bitbucket.org:444') + '/commits',
    ROOT + '/other/../commits', ROOT + '/%2e%2e/repo/commits', ROOT + '/commits%2Fother',
    ROOT + '/commits\\other', ROOT.replace('/repo', '/other') + '/commits',
  ])('rejects unsafe cursor %s before any request', async cursor => {
    await expect(new BitbucketClient().listCommitsPage('repo', { cursor })).rejects.toThrow(/cursor/i);
    expect(calls).toHaveLength(0);
  });

  it('follows server next links for existing list clients until the requested limit', async () => {
    replies = [{ data: { values: [{ hash: 'a' }], next: ROOT + '/commits?page=2' } },
      { data: { values: [{ hash: 'b' }, { hash: 'c' }, { hash: 'd' }] } }];
    expect((await new BitbucketClient().listCommits('repo', { limit: 3 })).map(c => c.hash)).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(2);
  });

  it('rejects repeated pagination links instead of looping', async () => {
    const next = ROOT + '/commits?page=2';
    replies = [{ data: { values: [], next } }, { data: { values: [], next } }];
    await expect(new BitbucketClient().listCommits('repo')).rejects.toThrow(/pagination/i);
    expect(calls).toHaveLength(2);
  });
});

describe('SPEC-3 history operations', () => {
  it.each(['', '.', '..', 'release/../main'])('rejects invalid refs %s before requesting', ref => {
    expect(() => new BitbucketClient().getTag('repo', ref)).toThrow(/revision/i);
    expect(calls).toHaveLength(0);
  });

  it('returns file history and tag queries with explicit continuation', async () => {
    const client = new BitbucketClient();
    replies = [{ data: { values: [{ path: 'old.ts', commit: { hash: 'old' } }], next: ROOT + '/filehistory/release%2Fv1/src/a.ts?page=2' } }, { data: { values: [{ name: 'v2' }] } }];
    const history = await client.getFileHistory('repo', 'src/a.ts', 'release/v1');
    expect(history.values[0].path).toBe('old.ts');
    expect(history.has_more).toBe(true);
    expect(calls[0].url).toContain('/filehistory/release%2Fv1/src/a.ts');
    const tags = await client.listTagsPage('repo', { query: 'name ~ "v2"', sort: '-name' });
    expect(tags.values[0].name).toBe('v2');
    expect(calls[1].params).toMatchObject({ q: 'name ~ "v2"', sort: '-name' });
  });

  it('preserves full file-history commit hashes without inventing absent metadata', async () => {
    const hash = 'abc123'.repeat(6) + '1234';
    replies = [{ data: { values: [{ path: 'old.ts', commit: { type: 'commit', hash, links: {} } }] } }];
    expect(await sourceTools.get_file_history({ repo_slug: 'repo', path: 'src/a.ts' })).toEqual({
      history: [{ path: 'old.ts', commit: { hash } }], has_more: false, next_cursor: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('serializes repeated include/exclude filters using Bitbucket syntax', async () => {
    await new BitbucketClient().listCommitsPage('repo', { branch: 'main', include: ['release/v2', 'other'], exclude: ['v1', 'old'], path: 'src/a.ts' });
    const query = new URL(axios.getUri(calls[0])).searchParams;
    expect(query.getAll('include')).toEqual(['main', 'release/v2', 'other']);
    expect(query.getAll('exclude')).toEqual(['v1', 'old']);
    expect(query.has('include[]')).toBe(false);
    expect(query.get('path')).toBe('src/a.ts');
  });

  it('compares base to head without silently discarding files after 50', async () => {
    replies = [{ data: { hash: 'a'.repeat(40) } }, { data: { hash: 'b'.repeat(40) } },
      { data: { values: Array.from({ length: 75 }, (_, i) => ({ new: { path: `${i}.ts` }, status: 'added', lines_added: 1 })), next: ROOT + '/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa?page=2' } }];
    const result = await commitTools.compare_commits({ repo_slug: 'repo', base: 'aaaaaaaaaaaa', head: 'bbbbbbbbbbbb', limit: 100 });
    expect(result.files).toHaveLength(75);
    expect(result.has_more).toBe(true);
    expect(calls[2].url).toContain('/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa');
    expect(calls[2].params.topic).toBe(false);
  });

  it.each([
    { base: 'main', head: 'release/v2' },
    { base: 'aaaaaaa', head: 'bbbbbbb' },
  ])('resolves named and short refs before following canonical diffstat cursors: %j', async refs => {
    const base = 'aaaaaaaaaaaa' + '1'.repeat(28);
    const head = 'bbbbbbbbbbbb' + '2'.repeat(28);
    const next = ROOT + '/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa?page=2&pagelen=1&topic=false';
    replies = [{ data: { hash: base } }, { data: { hash: head } },
      { data: { values: [{ new: { path: 'first.ts' } }], next } },
      { data: { hash: base } }, { data: { hash: head } }, { data: { values: [{ new: { path: 'second.ts' } }] } }];
    const client = new BitbucketClient();
    const first = await client.compareCommitsPage('repo', refs.base, refs.head, { limit: 1 });
    expect(calls[0].url).toBe('repositories/test-workspace/repo/commit/' + encodeURIComponent(refs.base));
    expect(calls[1].url).toBe('repositories/test-workspace/repo/commit/' + encodeURIComponent(refs.head));
    expect(calls[2].url).toContain('/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa');
    expect(first.next_cursor).toBe(next);
    const second = await client.compareCommitsPage('repo', refs.base, refs.head, { cursor: first.next_cursor! });
    expect(second.values[0]).toMatchObject({ new: { path: 'second.ts' } });
    expect(calls[5].url).toBe(next);
    expect(second.has_more).toBe(false);
  });

  it('resolves full hashes exactly before canonicalizing, and still rejects unrelated comparison cursors', async () => {
    const base = 'A'.repeat(40);
    const head = 'B'.repeat(40);
    const next = ROOT + '/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa?page=2';
    replies = [{ data: { hash: base } }, { data: { hash: head } }, { data: { values: [], next } },
      { data: { hash: base } }, { data: { hash: head } }, { data: { values: [] } },
      { data: { hash: base } }, { data: { hash: head } }];
    const client = new BitbucketClient();
    const first = await client.compareCommitsPage('repo', base, head);
    await client.compareCommitsPage('repo', base, head, { cursor: first.next_cursor! });
    expect(calls).toHaveLength(6);
    expect(calls[0].url).toContain('/commit/' + base);
    expect(calls[2].url).toContain('/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa');
    await expect(client.compareCommitsPage('repo', base, head, { cursor: ROOT + '/diffstat/cccccccccccc..aaaaaaaaaaaa?page=2' })).rejects.toThrow(/cursor/i);
    expect(calls).toHaveLength(8);
  });

  it('does not turn an invalid full SHA into an existing shorter prefix', async () => {
    const invalid = 'aaaaaaaaaaaa' + '0'.repeat(28);
    replies = [{ status: 404 }];
    await expect(new BitbucketClient().compareCommitsPage('repo', invalid, 'main')).rejects.toThrow(/not found.*404/i);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/commit/' + invalid);
  });

  it('resolves hexadecimal branch names to their actual target commit', async () => {
    replies = [{ data: { hash: 'c'.repeat(40) } }, { data: { hash: 'd'.repeat(40) } }, { data: { values: [] } }];
    await new BitbucketClient().compareCommitsPage('repo', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb');
    expect(calls[0].url).toContain('/commit/aaaaaaaaaaaa');
    expect(calls[1].url).toContain('/commit/bbbbbbbbbbbb');
    expect(calls[2].url).toContain('/diffstat/dddddddddddd..cccccccccccc');
  });

  it('rejects a cursor if a named revision moved between comparison pages', async () => {
    replies = [{ data: { hash: 'c'.repeat(40) } }, { data: { hash: 'b'.repeat(40) } }];
    await expect(new BitbucketClient().compareCommitsPage('repo', 'main', 'release', {
      cursor: ROOT + '/diffstat/bbbbbbbbbbbb..aaaaaaaaaaaa?page=2',
    })).rejects.toThrow(/cursor/i);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.url?.includes('/commit/'))).toBe(true);
  });

  it('encodes slash refs, returns literal text diff, and exposes merge base and tag lookup', async () => {
    const client = new BitbucketClient();
    replies = [{ data: '"literal diff"' }, { data: { hash: 'ancestor' } }, { data: { name: 'release/v1' } }];
    expect(await client.getCommitDiff('repo', 'base', 'feature/new', { path: 'a.ts' })).toBe('"literal diff"');
    expect(calls[0].url).toContain('/diff/feature%2Fnew..base');
    expect(calls[0].responseType).toBe('text');
    expect(calls[0].params.topic).toBe(false);
    expect((await client.getMergeBase('repo', 'base', 'head'))?.hash).toBe('ancestor');
    expect((await client.getTag('repo', 'release/v1'))?.name).toBe('release/v1');
    expect(calls[2].url).toContain('/refs/tags/release%2Fv1');
  });

  it('exposes clipped diff continuation including a single large file', async () => {
    replies = [{ data: 'abcdef' }, { data: 'abcdef' }];
    const first = await commitTools.get_commit_diff({ repo_slug: 'repo', base: 'a', head: 'b', max_chars: 3 });
    expect(first).toMatchObject({ diff: 'abc', offset: 0, next_offset: 3, truncated: true, total_chars: 6 });
    expect(await commitTools.get_commit_diff({ repo_slug: 'repo', base: 'a', head: 'b', offset: 3, max_chars: 3 }))
      .toMatchObject({ diff: 'def', next_offset: null, truncated: false });
  });
});

describe('SPEC-4 bounded resilient requests', () => {
  it('does not retry generic bad-response failures such as response-size limits', async () => {
    replies = [{ code: 'ERR_BAD_RESPONSE', message: 'maxContentLength size of 100 exceeded' }, { data: {} }];
    await expect(new BitbucketClient().getRepository('repo')).rejects.toThrow(BitbucketError);
    expect(calls).toHaveLength(1);
  });

  it.each([{ code: 'ECONNRESET' }, { code: 'ETIMEDOUT' }, { status: 503 }])('recovers reads from %j', async failure => {
    replies = [failure, { data: { name: 'ok' } }];
    expect(await new BitbucketClient().getRepository('repo')).toMatchObject({ name: 'ok' });
    expect(calls).toHaveLength(2);
  });

  it('does not replay an ambiguous write', async () => {
    replies = [{ code: 'ECONNRESET' }, { data: {} }];
    await expect(new BitbucketClient().createTag('repo', 'v1', 'main')).rejects.toThrow(BitbucketError);
    expect(calls).toHaveLength(1);
  });

  it('does not replay writes after server errors either', async () => {
    replies = [{ status: 503 }, { data: {} }];
    await expect(new BitbucketClient().createTag('repo', 'v1', 'main')).rejects.toThrow(BitbucketError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry authorization failures', async () => {
    replies = [{ status: 401 }];
    await expect(new BitbucketClient().getRepository('repo')).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  it('honors HTTP-date Retry-After', async () => {
    const header = new Date(Date.now() + 3000).toUTCString();
    replies = [{ status: 429, headers: { 'retry-after': header } }, { data: {} }];
    expect(await new BitbucketClient().getRepository('repo')).toEqual({});
    expect(calls).toHaveLength(2);
  });

  it('bounds total elapsed retry time and caps each attempt timeout', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(31000);
    replies = [{ status: 503 }, { data: {} }];
    await expect(new BitbucketClient().getRepository('repo')).rejects.toThrow(/budget/i);
    expect(calls).toHaveLength(1);
    expect(calls[0].timeout).toBe(30000);
  });

  it.each(['bad', '-2', 'nan', 'inf'])('handles malformed Retry-After %s', async header => {
    replies = [{ status: 429, headers: { 'retry-after': header } }, { data: {} }];
    expect(await new BitbucketClient().getRepository('repo')).toEqual({});
    expect(calls).toHaveLength(2);
  });

  it('fails fast instead of sleeping beyond the retry budget', async () => {
    replies = [{ status: 429, headers: { 'retry-after': '3600' } }];
    await expect(new BitbucketClient().getRepository('repo')).rejects.toThrow(/budget/i);
    expect(calls).toHaveLength(1);
  });

  it('stays usable after retry exhaustion', async () => {
    replies = [{ code: 'ECONNRESET' }, { code: 'ECONNRESET' }, { code: 'ECONNRESET' }, { data: { name: 'ok' } }];
    const client = new BitbucketClient();
    await expect(client.getRepository('repo')).rejects.toThrow(/Network/i);
    expect(await client.getRepository('repo')).toMatchObject({ name: 'ok' });
    expect(calls).toHaveLength(4);
  });
});
