/**
 * Webhook tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_webhooks',
    description: 'List webhooks configured for a repository.',
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
    name: 'create_webhook',
    description: 'Create a webhook for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        url: { type: 'string', description: 'URL to call when events occur' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of events (e.g., repo:push, pullrequest:created, pullrequest:merged)',
        },
        description: { type: 'string', description: 'Webhook description (optional)', default: '' },
        active: { type: 'boolean', description: 'Whether webhook is active (default: true)', default: true },
      },
      required: ['repo_slug', 'url', 'events'],
    },
  },
  {
    name: 'get_webhook',
    description: 'Get details about a specific webhook.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        webhook_uuid: { type: 'string', description: 'Webhook UUID' },
      },
      required: ['repo_slug', 'webhook_uuid'],
    },
  },
  {
    name: 'delete_webhook',
    description: 'Delete a webhook.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        webhook_uuid: { type: 'string', description: 'Webhook UUID' },
      },
      required: ['repo_slug', 'webhook_uuid'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_webhooks: async (args) => {
    const client = getClient();
    const webhooks = await client.listWebhooks(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      webhooks: webhooks.map(w => ({
        uuid: w.uuid,
        url: w.url,
        description: w.description,
        events: w.events,
        active: w.active,
      })),
    };
  },

  create_webhook: async (args) => {
    const client = getClient();
    const result = await client.createWebhook(args.repo_slug as string, {
      url: args.url as string,
      events: args.events as string[],
      description: args.description as string,
      active: args.active as boolean ?? true,
    });
    return {
      uuid: result.uuid,
      url: result.url,
      events: result.events,
      active: result.active,
    };
  },

  get_webhook: async (args) => {
    const client = getClient();
    const result = await client.getWebhook(args.repo_slug as string, args.webhook_uuid as string);
    if (!result) {
      return notFoundResponse('Webhook', args.webhook_uuid as string);
    }
    return {
      uuid: result.uuid,
      url: result.url,
      description: result.description,
      events: result.events,
      active: result.active,
    };
  },

  delete_webhook: async (args) => {
    const client = getClient();
    await client.deleteWebhook(args.repo_slug as string, args.webhook_uuid as string);
    return {};
  },
};

