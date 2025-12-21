/**
 * Branch Restriction tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit } from '../utils.js';

export const definitions: Tool[] = [
  {
    name: 'list_branch_restrictions',
    description: 'List branch restrictions (protection rules) in a repository.',
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
    name: 'create_branch_restriction',
    description: 'Create a branch restriction (protection rule).',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        kind: {
          type: 'string',
          description: 'Type of restriction: push, force, delete, restrict_merges, require_passing_builds_to_merge, require_approvals_to_merge, etc.',
        },
        pattern: { type: 'string', description: 'Branch pattern (e.g., "main", "release/*"). Required for glob match.', default: '' },
        branch_match_kind: { type: 'string', description: 'How to match branches: "glob" or "branching_model"', default: 'glob' },
        branch_type: { type: 'string', description: 'Branch type when using branching_model: development, production, feature, etc.', default: '' },
        value: { type: 'number', description: 'Numeric value (e.g., number of required approvals)', default: 0 },
      },
      required: ['repo_slug', 'kind'],
    },
  },
  {
    name: 'delete_branch_restriction',
    description: 'Delete a branch restriction.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        restriction_id: { type: 'number', description: 'Restriction ID' },
      },
      required: ['repo_slug', 'restriction_id'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  list_branch_restrictions: async (args) => {
    const client = getClient();
    const restrictions = await client.listBranchRestrictions(args.repo_slug as string, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      restrictions: restrictions.map(r => ({
        id: r.id,
        kind: r.kind,
        pattern: r.pattern,
        branch_match_kind: r.branch_match_kind,
        branch_type: r.branch_type,
        value: r.value,
      })),
    };
  },

  create_branch_restriction: async (args) => {
    const client = getClient();
    const result = await client.createBranchRestriction(args.repo_slug as string, {
      kind: args.kind as string,
      pattern: args.pattern as string,
      branchMatchKind: args.branch_match_kind as string || 'glob',
      branchType: args.branch_type as string || undefined,
      value: args.value as number || undefined,
    });
    return {
      id: result.id,
      kind: result.kind,
    };
  },

  delete_branch_restriction: async (args) => {
    const client = getClient();
    await client.deleteBranchRestriction(args.repo_slug as string, args.restriction_id as number);
    return {};
  },
};

