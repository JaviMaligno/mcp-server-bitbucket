/**
 * Commit tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse, truncateHash } from '../utils.js';
import { CommitStatusState } from '../types.js';

export const definitions: Tool[] = [
  {
    name: 'list_commits',
    description: 'List a page of commits. Use include/exclude for commits between revisions (include=head, exclude=base); continue with next_cursor until has_more is false.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        branch: { type: 'string', description: 'Branch, tag or SHA to include (alias for include)' },
        include: { type: 'array', items: { type: 'string' }, description: 'Include commits reachable from these branches, tags or SHAs' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'Exclude commits reachable from these revisions' },
        cursor: { type: 'string', description: 'Opaque next_cursor from this tool; retains its page size and filters' },
        path: { type: 'string', description: 'Filter by file path - only commits that modified this path (optional)' },
        limit: { type: 'number', description: 'Maximum results (default: 20)', default: 20 },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'get_commit',
    description: 'Get detailed information about a specific commit.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        commit: { type: 'string', description: 'Commit hash (full or short)' },
      },
      required: ['repo_slug', 'commit'],
    },
  },
  {
    name: 'compare_commits',
    description: 'Compare base to head (branches, tags or SHAs). Returns a page of changed files and line counts; follow next_cursor for all files.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        base: { type: 'string', description: 'Base commit hash or branch name' },
        head: { type: 'string', description: 'Head commit hash, tag or branch name' },
        path: { type: 'string', description: 'Optional file path filter' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        cursor: { type: 'string', description: 'Opaque next_cursor; retains page size and filters' },
      },
      required: ['repo_slug', 'base', 'head'],
    },
  },
  {
    name: 'get_commit_diff',
    description: 'Get the raw Git-style diff from base to head. Continue large diffs with next_offset; pin revisions to commit hashes while paging. API-side diff limits still apply.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' },
        path: { type: 'string', description: 'Optional file path filter' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        max_chars: { type: 'integer', minimum: 1, maximum: 100000, default: 20000 },
      },
      required: ['repo_slug', 'base', 'head'],
    },
  },
  {
    name: 'get_merge_base',
    description: 'Get a best common ancestor of two branches, tags or commit hashes. Bitbucket returns one ancestor when multiple best ancestors exist.',
    inputSchema: {
      type: 'object',
      properties: { repo_slug: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' } },
      required: ['repo_slug', 'base', 'head'],
    },
  },
  {
    name: 'get_commit_statuses',
    description: 'Get build/CI statuses for a commit.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        commit: { type: 'string', description: 'Commit hash' },
        limit: { type: 'number', description: 'Maximum results (default: 20)', default: 20 },
      },
      required: ['repo_slug', 'commit'],
    },
  },
  {
    name: 'create_commit_status',
    description: 'Create a build status for a commit. Use this to report CI/CD status from external systems.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        commit: { type: 'string', description: 'Commit hash' },
        state: { type: 'string', description: 'Status state: SUCCESSFUL, FAILED, INPROGRESS, STOPPED' },
        key: { type: 'string', description: 'Unique identifier for this status' },
        url: { type: 'string', description: 'URL to the build details (optional)' },
        name: { type: 'string', description: 'Display name for the status (optional)' },
        description: { type: 'string', description: 'Status description (optional)' },
      },
      required: ['repo_slug', 'commit', 'state', 'key'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_commits: async (args) => {
    const client = getClient();
    const page = await client.listCommitsPage(args.repo_slug as string, {
      branch: args.branch as string,
      include: args.include as string[] | undefined,
      exclude: args.exclude as string[] | undefined,
      path: args.path as string,
      cursor: args.cursor as string,
      limit: validateLimit((args.limit as number) ?? 20),
    });
    return {
      commits: page.values.map(c => ({ hash: truncateHash(c.hash), message: c.message, author: c.author?.raw, date: c.date })),
      has_more: page.has_more,
      next_cursor: page.next_cursor,
    };
  },

  get_commit: async (args) => {
    const client = getClient();
    const result = await client.getCommit(args.repo_slug as string, args.commit as string);
    if (!result) {
      return notFoundResponse('Commit', args.commit as string);
    }
    return {
      hash: result.hash,
      message: result.message,
      author: result.author?.raw,
      date: result.date,
      parents: result.parents?.map(p => truncateHash(p.hash)),
    };
  },

  compare_commits: async (args) => {
    const client = getClient();
    const page = await client.compareCommitsPage(args.repo_slug as string, args.base as string, args.head as string, {
      path: args.path as string, limit: validateLimit((args.limit as number) ?? 50), cursor: args.cursor as string,
    });
    const files = page.values as Array<{ new?: { path?: string }; old?: { path?: string }; status?: string; lines_added?: number; lines_removed?: number }>;
    return {
      files: files.map(f => ({ path: f.new?.path || f.old?.path, status: f.status, '+': f.lines_added || 0, '-': f.lines_removed || 0 })),
      has_more: page.has_more, next_cursor: page.next_cursor,
    };
  },

  get_commit_diff: async (args) => {
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    const maxChars = args.max_chars === undefined ? 20000 : Number(args.max_chars);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 100000) {
      return { success: false, error: 'offset must be a nonnegative integer; max_chars must be an integer between 1 and 100000' };
    }
    const diff = await getClient().getCommitDiff(args.repo_slug as string, args.base as string, args.head as string, { path: args.path as string });
    if (diff === null) return notFoundResponse('Diff', `${args.base}..${args.head}`);
    const end = Math.min(offset + maxChars, diff.length);
    return { diff: diff.slice(offset, end), offset, next_offset: end < diff.length ? end : null, truncated: end < diff.length, total_chars: diff.length };
  },

  get_merge_base: async (args) => {
    const result = await getClient().getMergeBase(args.repo_slug as string, args.base as string, args.head as string);
    return result ? { hash: result.hash, message: result.message, author: result.author?.raw, date: result.date, parents: result.parents?.map(p => truncateHash(p.hash)) }
      : notFoundResponse('Common ancestor', `${args.base}..${args.head}`);
  },

  get_commit_statuses: async (args) => {
    const client = getClient();
    const statuses = await client.getCommitStatuses(args.repo_slug as string, args.commit as string, {
      limit: validateLimit((args.limit as number) || 20),
    });
    return {
      commit: truncateHash(args.commit as string),
      statuses: statuses.map(s => ({
        key: s.key,
        state: s.state,
        name: s.name,
        description: s.description,
        url: s.url,
        created: s.created_on,
      })),
    };
  },

  create_commit_status: async (args) => {
    const state = (args.state as string).toUpperCase();
    const validStates = Object.values(CommitStatusState);
    if (!validStates.includes(state as CommitStatusState)) {
      return {
        success: false,
        error: `Invalid state '${args.state}'. Must be one of: ${validStates.join(', ')}`,
      };
    }

    const client = getClient();
    const result = await client.createCommitStatus(args.repo_slug as string, args.commit as string, {
      state,
      key: args.key as string,
      url: args.url as string,
      name: args.name as string,
      description: args.description as string,
    });
    return {
      key: result.key,
      state: result.state,
      name: result.name,
      url: result.url,
    };
  },
};

