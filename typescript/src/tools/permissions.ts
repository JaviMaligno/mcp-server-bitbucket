/**
 * Permission tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';

export const definitions: Tool[] = [
  // User permissions
  {
    name: 'list_user_permissions',
    description: 'List user permissions for a repository.',
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
    name: 'get_user_permission',
    description: "Get a specific user's permission for a repository.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        selected_user: { type: 'string', description: "User's account_id or UUID" },
      },
      required: ['repo_slug', 'selected_user'],
    },
  },
  {
    name: 'update_user_permission',
    description: "Update or add a user's permission for a repository.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        selected_user: { type: 'string', description: "User's account_id or UUID" },
        permission: { type: 'string', description: 'Permission level: "read", "write", or "admin"' },
      },
      required: ['repo_slug', 'selected_user', 'permission'],
    },
  },
  {
    name: 'delete_user_permission',
    description: "Remove a user's explicit permission from a repository.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        selected_user: { type: 'string', description: "User's account_id or UUID" },
      },
      required: ['repo_slug', 'selected_user'],
    },
  },
  // Group permissions
  {
    name: 'list_group_permissions',
    description: 'List group permissions for a repository.',
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
    name: 'get_group_permission',
    description: "Get a specific group's permission for a repository.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        group_slug: { type: 'string', description: 'Group slug' },
      },
      required: ['repo_slug', 'group_slug'],
    },
  },
  {
    name: 'update_group_permission',
    description: "Update or add a group's permission for a repository.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        group_slug: { type: 'string', description: 'Group slug' },
        permission: { type: 'string', description: 'Permission level: "read", "write", or "admin"' },
      },
      required: ['repo_slug', 'group_slug', 'permission'],
    },
  },
  {
    name: 'delete_group_permission',
    description: "Remove a group's explicit permission from a repository.",
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        group_slug: { type: 'string', description: 'Group slug' },
      },
      required: ['repo_slug', 'group_slug'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_user_permissions: async (args) => {
    const client = getClient();
    const permissions = await client.listUserPermissions(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      users: permissions.map(p => ({
        user: p.user?.display_name,
        account_id: p.user?.account_id,
        permission: p.permission,
      })),
    };
  },

  get_user_permission: async (args) => {
    const client = getClient();
    const result = await client.getUserPermission(args.repo_slug as string, args.selected_user as string);
    if (!result) {
      return notFoundResponse('User permission', args.selected_user as string);
    }
    return {
      user: result.user?.display_name,
      account_id: result.user?.account_id,
      permission: result.permission,
    };
  },

  update_user_permission: async (args) => {
    const client = getClient();
    const result = await client.updateUserPermission(
      args.repo_slug as string,
      args.selected_user as string,
      args.permission as string
    );
    return {
      user: result.user?.display_name,
      permission: result.permission,
    };
  },

  delete_user_permission: async (args) => {
    const client = getClient();
    await client.deleteUserPermission(args.repo_slug as string, args.selected_user as string);
    return {};
  },

  list_group_permissions: async (args) => {
    const client = getClient();
    const permissions = await client.listGroupPermissions(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      groups: permissions.map(p => ({
        group: p.group?.name,
        slug: p.group?.slug,
        permission: p.permission,
      })),
    };
  },

  get_group_permission: async (args) => {
    const client = getClient();
    const result = await client.getGroupPermission(args.repo_slug as string, args.group_slug as string);
    if (!result) {
      return notFoundResponse('Group permission', args.group_slug as string);
    }
    return {
      group: result.group?.name,
      slug: result.group?.slug,
      permission: result.permission,
    };
  },

  update_group_permission: async (args) => {
    const client = getClient();
    const result = await client.updateGroupPermission(
      args.repo_slug as string,
      args.group_slug as string,
      args.permission as string
    );
    return {
      group: result.group?.name,
      permission: result.permission,
    };
  },

  delete_group_permission: async (args) => {
    const client = getClient();
    await client.deleteGroupPermission(args.repo_slug as string, args.group_slug as string);
    return {};
  },
};

