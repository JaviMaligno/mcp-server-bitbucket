/**
 * Branch tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_branches',
    description: 'List branches in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        limit: { type: 'number', description: 'Maximum results (default: 50)', default: 50 },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'get_branch',
    description: 'Get information about a specific branch.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        branch_name: { type: 'string', description: 'Branch name' },
      },
      required: ['repo_slug', 'branch_name'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_branches: async (args) => {
    const client = getClient();
    const branches = await client.listBranches(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      branches: branches.map(b => ({
        name: b.name,
        commit: b.target?.hash?.substring(0, 7),
        message: b.target?.message,
        date: b.target?.date,
      })),
    };
  },

  get_branch: async (args) => {
    const client = getClient();
    const result = await client.getBranch(args.repo_slug as string, args.branch_name as string);
    if (!result) {
      return notFoundResponse('Branch', args.branch_name as string);
    }
    return {
      name: result.name,
      latest_commit: {
        hash: result.target?.hash,
        message: result.target?.message || '',
        author: result.target?.author?.raw,
        date: result.target?.date,
      },
    };
  },
};

