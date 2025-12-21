/**
 * Source (File Browsing) tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'get_file_content',
    description: 'Get the content of a file from a repository. Read file contents without cloning.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        path: { type: 'string', description: 'File path (e.g., "src/main.py", "README.md")' },
        ref: { type: 'string', description: 'Branch, tag, or commit hash (default: "main")', default: 'main' },
      },
      required: ['repo_slug', 'path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory in a repository. Browse repository structure without cloning.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        path: { type: 'string', description: 'Directory path (empty string for root)', default: '' },
        ref: { type: 'string', description: 'Branch, tag, or commit hash (default: "main")', default: 'main' },
        limit: { type: 'number', description: 'Maximum entries (default: 100)', default: 100 },
      },
      required: ['repo_slug'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  get_file_content: async (args) => {
    const client = getClient();
    const ref = (args.ref as string) || 'main';
    const content = await client.getFileContent(args.repo_slug as string, args.path as string, ref);
    
    if (content === null) {
      return { error: `File '${args.path}' not found at ref '${ref}'` };
    }

    return {
      path: args.path,
      ref,
      content,
      size: content.length,
    };
  },

  list_directory: async (args) => {
    const client = getClient();
    const ref = (args.ref as string) || 'main';
    const path = (args.path as string) || '';
    
    const entries = await client.listDirectory(args.repo_slug as string, path, {
      ref,
      limit: validateLimit((args.limit as number) || 100),
    });

    return {
      path: path || '/',
      ref,
      entries: entries.map(e => ({
        path: e.path,
        type: e.type === 'commit_directory' ? 'directory' : 'file',
        size: e.size,
      })),
    };
  },
};

