/**
 * Project tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_projects',
    description: 'List projects in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum results (default: 50)', default: 50 },
      },
      required: [],
    },
  },
  {
    name: 'get_project',
    description: 'Get information about a specific project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string', description: 'Project key (e.g., "DS", "PROJ")' },
      },
      required: ['project_key'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_projects: async (args) => {
    const client = getClient();
    const projects = await client.listProjects({
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      projects: projects.map(p => ({
        key: p.key,
        name: p.name,
        description: p.description,
      })),
    };
  },

  get_project: async (args) => {
    const client = getClient();
    const result = await client.getProject(args.project_key as string);
    if (!result) {
      return notFoundResponse('Project', args.project_key as string);
    }
    return {
      key: result.key,
      name: result.name,
      description: result.description,
      uuid: result.uuid,
    };
  },
};

