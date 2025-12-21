/**
 * Repository tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse, sanitizeSearchTerm } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'get_repository',
    description: 'Get information about a Bitbucket repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: {
          type: 'string',
          description: 'Repository slug (e.g., "anzsic_classifier")',
        },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'create_repository',
    description: 'Create a new Bitbucket repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: {
          type: 'string',
          description: 'Repository slug (lowercase, no spaces)',
        },
        project_key: {
          type: 'string',
          description: 'Project key to create repo under (optional)',
        },
        is_private: {
          type: 'boolean',
          description: 'Whether repository is private (default: true)',
          default: true,
        },
        description: {
          type: 'string',
          description: 'Repository description',
          default: '',
        },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'delete_repository',
    description: 'Delete a Bitbucket repository. WARNING: This action is irreversible!',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: {
          type: 'string',
          description: 'Repository slug to delete',
        },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'list_repositories',
    description: 'List and search repositories in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'Filter by project key (optional)',
        },
        search: {
          type: 'string',
          description: 'Simple search term for repository name (optional). Uses fuzzy matching.',
        },
        query: {
          type: 'string',
          description: 'Advanced Bitbucket query syntax (optional). Examples: name ~ "api", is_private = false',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50, max: 100)',
          default: 50,
        },
      },
      required: [],
    },
  },
  {
    name: 'update_repository',
    description: 'Update repository settings (project, visibility, description, name).',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: {
          type: 'string',
          description: 'Repository slug',
        },
        project_key: {
          type: 'string',
          description: 'Move to different project (optional)',
        },
        is_private: {
          type: 'boolean',
          description: 'Change visibility (optional)',
        },
        description: {
          type: 'string',
          description: 'Update description (optional)',
        },
        name: {
          type: 'string',
          description: 'Rename repository (optional)',
        },
      },
      required: ['repo_slug'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  get_repository: async (args) => {
    const client = getClient();
    const result = await client.getRepository(args.repo_slug as string);
    if (!result) {
      return notFoundResponse('Repository', args.repo_slug as string);
    }
    return {
      name: result.name,
      full_name: result.full_name,
      private: result.is_private,
      project: result.project?.key,
      description: result.description || '',
      main_branch: result.mainbranch?.name,
      clone_urls: client.extractCloneUrls(result),
      created: result.created_on,
      updated: result.updated_on,
    };
  },

  create_repository: async (args) => {
    const client = getClient();
    const result = await client.createRepository(args.repo_slug as string, {
      projectKey: args.project_key as string | undefined,
      isPrivate: args.is_private as boolean | undefined,
      description: args.description as string | undefined,
    });
    return {
      name: result.name,
      full_name: result.full_name,
      clone_urls: client.extractCloneUrls(result),
    };
  },

  delete_repository: async (args) => {
    const client = getClient();
    await client.deleteRepository(args.repo_slug as string);
    return {};
  },

  list_repositories: async (args) => {
    const client = getClient();
    let effectiveQuery = args.query as string | undefined;
    
    if (args.search && !args.query) {
      const safeSearch = sanitizeSearchTerm(args.search as string);
      effectiveQuery = `name ~ "${safeSearch}"`;
    }

    const repos = await client.listRepositories({
      projectKey: args.project_key as string | undefined,
      query: effectiveQuery,
      limit: validateLimit((args.limit as number) || 50),
    });

    return {
      repositories: repos.map(r => ({
        name: r.name,
        full_name: r.full_name,
        private: r.is_private,
        project: r.project?.key,
        description: r.description || '',
      })),
    };
  },

  update_repository: async (args) => {
    const client = getClient();
    const result = await client.updateRepository(args.repo_slug as string, {
      projectKey: args.project_key as string | undefined,
      isPrivate: args.is_private as boolean | undefined,
      description: args.description as string | undefined,
      name: args.name as string | undefined,
    });
    return {
      name: result.name,
      full_name: result.full_name,
      project: result.project?.key,
      private: result.is_private,
      description: result.description || '',
    };
  },
};

