/**
 * Tag tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, truncateHash } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_tags',
    description: 'List tags in a repository.',
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
    name: 'create_tag',
    description: 'Create a new tag in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        name: { type: 'string', description: 'Tag name (e.g., "v1.0.0")' },
        target: { type: 'string', description: 'Commit hash or branch name to tag' },
        message: { type: 'string', description: 'Optional tag message (for annotated tags)', default: '' },
      },
      required: ['repo_slug', 'name', 'target'],
    },
  },
  {
    name: 'delete_tag',
    description: 'Delete a tag from a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        tag_name: { type: 'string', description: 'Tag name to delete' },
      },
      required: ['repo_slug', 'tag_name'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_tags: async (args) => {
    const client = getClient();
    const tags = await client.listTags(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      tags: tags.map(t => ({
        name: t.name,
        target: truncateHash(t.target?.hash),
        message: t.message,
        date: t.target?.date,
        tagger: t.tagger?.raw,
      })),
    };
  },

  create_tag: async (args) => {
    const client = getClient();
    const result = await client.createTag(
      args.repo_slug as string,
      args.name as string,
      args.target as string,
      args.message as string || undefined
    );
    return {
      name: result.name,
      target: truncateHash(result.target?.hash),
      message: result.message || '',
    };
  },

  delete_tag: async (args) => {
    const client = getClient();
    await client.deleteTag(args.repo_slug as string, args.tag_name as string);
    return {};
  },
};

