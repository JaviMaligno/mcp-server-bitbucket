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
    description: 'List commits in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        branch: { type: 'string', description: 'Filter by branch name (optional)' },
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
    description: 'Compare two commits or branches and see files changed.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        base: { type: 'string', description: 'Base commit hash or branch name' },
        head: { type: 'string', description: 'Head commit hash or branch name' },
      },
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
    const commits = await client.listCommits(args.repo_slug as string, {
      branch: args.branch as string,
      path: args.path as string,
      limit: validateLimit((args.limit as number) || 20),
    });
    return {
      commits: commits.map(c => ({
        hash: truncateHash(c.hash),
        message: c.message,
        author: c.author?.raw,
        date: c.date,
      })),
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
    const result = await client.compareCommits(
      args.repo_slug as string,
      args.base as string,
      args.head as string
    );
    if (!result) {
      return { error: `Could not compare ${args.base}..${args.head}` };
    }
    const files = (result.values as Array<{
      new?: { path?: string };
      old?: { path?: string };
      status?: string;
      lines_added?: number;
      lines_removed?: number;
    }>) || [];
    return {
      files: files.slice(0, 50).map(f => ({
        path: f.new?.path || f.old?.path,
        status: f.status,
        '+': f.lines_added || 0,
        '-': f.lines_removed || 0,
      })),
    };
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

