/**
 * Pipeline tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'trigger_pipeline',
    description: 'Trigger a pipeline run on a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        branch: { type: 'string', description: 'Branch to run pipeline on (default: main)', default: 'main' },
        variables: { type: 'object', description: 'Custom pipeline variables as key-value pairs' },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'get_pipeline',
    description: 'Get status of a pipeline run.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pipeline_uuid: { type: 'string', description: 'Pipeline UUID' },
      },
      required: ['repo_slug', 'pipeline_uuid'],
    },
  },
  {
    name: 'list_pipelines',
    description: 'List recent pipeline runs for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        limit: { type: 'number', description: 'Maximum results (default: 10)', default: 10 },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'get_pipeline_logs',
    description: 'Get logs for a pipeline run. If step_uuid is not provided, returns list of steps.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pipeline_uuid: { type: 'string', description: 'Pipeline UUID' },
        step_uuid: { type: 'string', description: 'Step UUID (optional, get from steps list first)' },
      },
      required: ['repo_slug', 'pipeline_uuid'],
    },
  },
  {
    name: 'stop_pipeline',
    description: 'Stop a running pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pipeline_uuid: { type: 'string', description: 'Pipeline UUID' },
      },
      required: ['repo_slug', 'pipeline_uuid'],
    },
  },
  {
    name: 'list_pipeline_variables',
    description: 'List pipeline variables for a repository.',
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
    name: 'get_pipeline_variable',
    description: 'Get details about a specific pipeline variable.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        variable_uuid: { type: 'string', description: 'Variable UUID' },
      },
      required: ['repo_slug', 'variable_uuid'],
    },
  },
  {
    name: 'create_pipeline_variable',
    description: 'Create a pipeline variable.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        key: { type: 'string', description: 'Variable name' },
        value: { type: 'string', description: 'Variable value' },
        secured: { type: 'boolean', description: 'Encrypt the value (secured variables cannot be read back)', default: false },
      },
      required: ['repo_slug', 'key', 'value'],
    },
  },
  {
    name: 'update_pipeline_variable',
    description: "Update a pipeline variable's value.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        variable_uuid: { type: 'string', description: 'Variable UUID' },
        value: { type: 'string', description: 'New variable value' },
      },
      required: ['repo_slug', 'variable_uuid', 'value'],
    },
  },
  {
    name: 'delete_pipeline_variable',
    description: 'Delete a pipeline variable.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        variable_uuid: { type: 'string', description: 'Variable UUID' },
      },
      required: ['repo_slug', 'variable_uuid'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  trigger_pipeline: async (args) => {
    const client = getClient();
    const result = await client.triggerPipeline(args.repo_slug as string, {
      branch: args.branch as string || 'main',
      variables: args.variables as Record<string, string>,
    });
    return {
      uuid: result.uuid,
      build_number: result.build_number,
      state: result.state?.name,
    };
  },

  get_pipeline: async (args) => {
    const client = getClient();
    const result = await client.getPipeline(args.repo_slug as string, args.pipeline_uuid as string);
    if (!result) {
      return notFoundResponse('Pipeline', args.pipeline_uuid as string);
    }
    return {
      uuid: result.uuid,
      build_number: result.build_number,
      state: result.state?.name,
      result: result.state?.result?.name,
      branch: result.target?.ref_name,
      created: result.created_on,
      completed: result.completed_on,
      duration: result.duration_in_seconds,
    };
  },

  list_pipelines: async (args) => {
    const client = getClient();
    const pipelines = await client.listPipelines(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 10),
    });
    return {
      pipelines: pipelines.map(p => ({
        uuid: p.uuid,
        build_number: p.build_number,
        state: p.state?.name,
        result: p.state?.result?.name,
        branch: p.target?.ref_name,
        created: p.created_on,
      })),
    };
  },

  get_pipeline_logs: async (args) => {
    const client = getClient();
    const pipelineUuid = args.pipeline_uuid as string;
    const stepUuid = args.step_uuid as string | undefined;

    if (!stepUuid) {
      const steps = await client.getPipelineSteps(args.repo_slug as string, pipelineUuid);
      return {
        message: 'Provide step_uuid to get logs for a specific step',
        steps: steps.map(s => ({
          uuid: s.uuid,
          name: s.name,
          state: s.state?.name,
          result: s.state?.result?.name,
          duration: s.duration_in_seconds,
        })),
      };
    }

    const logs = await client.getPipelineLogs(args.repo_slug as string, pipelineUuid, stepUuid);
    return {
      step_uuid: stepUuid,
      logs: logs || '(no logs available)',
    };
  },

  stop_pipeline: async (args) => {
    const client = getClient();
    const result = await client.stopPipeline(args.repo_slug as string, args.pipeline_uuid as string);
    return {
      uuid: result.uuid,
      state: result.state?.name,
    };
  },

  list_pipeline_variables: async (args) => {
    const client = getClient();
    const variables = await client.listPipelineVariables(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      variables: variables.map(v => ({
        uuid: v.uuid,
        key: v.key,
        secured: v.secured,
        value: v.secured ? undefined : v.value,
      })),
    };
  },

  get_pipeline_variable: async (args) => {
    const client = getClient();
    const result = await client.getPipelineVariable(args.repo_slug as string, args.variable_uuid as string);
    if (!result) {
      return notFoundResponse('Pipeline variable', args.variable_uuid as string);
    }
    return {
      uuid: result.uuid,
      key: result.key,
      secured: result.secured,
      value: result.secured ? undefined : result.value,
    };
  },

  create_pipeline_variable: async (args) => {
    const client = getClient();
    const result = await client.createPipelineVariable(
      args.repo_slug as string,
      args.key as string,
      args.value as string,
      args.secured as boolean ?? false
    );
    return {
      uuid: result.uuid,
      key: result.key,
      secured: result.secured,
    };
  },

  update_pipeline_variable: async (args) => {
    const client = getClient();
    const result = await client.updatePipelineVariable(
      args.repo_slug as string,
      args.variable_uuid as string,
      args.value as string
    );
    return {
      uuid: result.uuid,
      key: result.key,
      secured: result.secured,
    };
  },

  delete_pipeline_variable: async (args) => {
    const client = getClient();
    await client.deletePipelineVariable(args.repo_slug as string, args.variable_uuid as string);
    return {};
  },
};

