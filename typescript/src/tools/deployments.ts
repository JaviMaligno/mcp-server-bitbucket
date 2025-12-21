/**
 * Deployment tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_environments',
    description: 'List deployment environments for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        limit: { type: 'number', description: 'Maximum results (default: 20)', default: 20 },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'get_environment',
    description: 'Get details about a specific deployment environment.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        environment_uuid: { type: 'string', description: 'Environment UUID' },
      },
      required: ['repo_slug', 'environment_uuid'],
    },
  },
  {
    name: 'list_deployment_history',
    description: 'Get deployment history for a specific environment.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        environment_uuid: { type: 'string', description: 'Environment UUID' },
        limit: { type: 'number', description: 'Maximum results (default: 20)', default: 20 },
      },
      required: ['repo_slug', 'environment_uuid'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_environments: async (args) => {
    const client = getClient();
    const environments = await client.listEnvironments(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 20),
    });
    return {
      environments: environments.map(e => ({
        uuid: e.uuid,
        name: e.name,
        type: e.environment_type?.name,
        rank: e.rank,
      })),
    };
  },

  get_environment: async (args) => {
    const client = getClient();
    const result = await client.getEnvironment(args.repo_slug as string, args.environment_uuid as string);
    if (!result) {
      return notFoundResponse('Environment', args.environment_uuid as string);
    }
    return {
      uuid: result.uuid,
      name: result.name,
      environment_type: result.environment_type?.name,
      rank: result.rank,
      restrictions: result.restrictions,
      lock: result.lock,
    };
  },

  list_deployment_history: async (args) => {
    const client = getClient();
    const deployments = await client.listDeploymentHistory(
      args.repo_slug as string,
      args.environment_uuid as string,
      { limit: validateLimit((args.limit as number) || 20) }
    );
    return {
      deployments: deployments.map(d => ({
        uuid: d.uuid,
        state: d.state?.name,
        started: d.state?.started_on,
        completed: d.state?.completed_on,
        commit: d.release?.commit?.hash?.substring(0, 7),
        pipeline_uuid: d.release?.pipeline?.uuid,
      })),
    };
  },
};

