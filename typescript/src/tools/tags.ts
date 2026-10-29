/**
 * Tag tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, truncateHash, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_tags',
    description: 'List a page of tags, optionally filtered with Bitbucket query syntax and sorted (name uses natural version order). Follow next_cursor for all tags.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        query: { type: 'string', description: 'Bitbucket filter, e.g. name ~ \"v2\" or target.hash = \"full-sha\"' },
        sort: { type: 'string', description: 'Sort field, e.g. name, -name, -target.date', default: '-target.date' },
        cursor: { type: 'string', description: 'Opaque next_cursor; retains page size and filters' },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'get_tag',
    description: 'Get a specific tag and its target commit without scanning tag pages.',
    inputSchema: { type: 'object', properties: { repo_slug: { type: 'string' }, tag_name: { type: 'string' } }, required: ['repo_slug', 'tag_name'] },
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
    const page = await client.listTagsPage(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) ?? 50),
      query: args.query as string, sort: args.sort as string, cursor: args.cursor as string,
    });
    return {
      tags: page.values.map(t => ({
        name: t.name,
        target: truncateHash(t.target?.hash),
        message: t.message,
        date: t.target?.date,
        tagger: t.tagger?.raw,
      })),
      has_more: page.has_more, next_cursor: page.next_cursor,
    };
  },

  get_tag: async (args) => {
    const tag = await getClient().getTag(args.repo_slug as string, args.tag_name as string);
    return tag ? { name: tag.name, target: tag.target?.hash, message: tag.message, date: tag.date, tagger: tag.tagger?.raw } : notFoundResponse('Tag', args.tag_name as string);
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

