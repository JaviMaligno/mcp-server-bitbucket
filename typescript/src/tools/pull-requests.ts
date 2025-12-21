/**
 * Pull Request tools for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse } from '../utils.js';
import { PRState, MergeStrategy } from '../types.js';

export const definitions: Tool[] = [
  {
    name: 'create_pull_request',
    description: 'Create a pull request in a Bitbucket repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        title: { type: 'string', description: 'PR title' },
        source_branch: { type: 'string', description: 'Source branch name' },
        destination_branch: { type: 'string', description: 'Target branch (default: main)', default: 'main' },
        description: { type: 'string', description: 'PR description in markdown', default: '' },
        close_source_branch: { type: 'boolean', description: 'Delete source branch after merge', default: true },
      },
      required: ['repo_slug', 'title', 'source_branch'],
    },
  },
  {
    name: 'get_pull_request',
    description: 'Get information about a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        state: { type: 'string', description: 'Filter by state: OPEN, MERGED, DECLINED, SUPERSEDED', default: 'OPEN' },
        limit: { type: 'number', description: 'Maximum results (default: 20, max: 100)', default: 20 },
      },
      required: ['repo_slug'],
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
        merge_strategy: { type: 'string', description: 'merge_commit, squash, or fast_forward', default: 'merge_commit' },
        close_source_branch: { type: 'boolean', description: 'Delete source branch after merge', default: true },
        message: { type: 'string', description: 'Optional merge commit message' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'list_pr_comments',
    description: 'List comments on a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
        limit: { type: 'number', description: 'Maximum results (default: 50)', default: 50 },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'add_pr_comment',
    description: 'Add a comment to a pull request. Can add general or inline comments.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
        content: { type: 'string', description: 'Comment content (markdown supported)' },
        file_path: { type: 'string', description: 'File path for inline comment (optional)' },
        line: { type: 'number', description: 'Line number for inline comment (optional, requires file_path)' },
      },
      required: ['repo_slug', 'pr_id', 'content'],
    },
  },
  {
    name: 'approve_pr',
    description: 'Approve a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'unapprove_pr',
    description: 'Remove your approval from a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'request_changes_pr',
    description: 'Request changes on a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'decline_pr',
    description: 'Decline (close without merging) a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
  {
    name: 'get_pr_diff',
    description: 'Get the diff of a pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_slug: { type: 'string', description: 'Repository slug' },
        pr_id: { type: 'number', description: 'Pull request ID' },
      },
      required: ['repo_slug', 'pr_id'],
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  create_pull_request: async (args) => {
    const client = getClient();
    const result = await client.createPullRequest(args.repo_slug as string, {
      title: args.title as string,
      sourceBranch: args.source_branch as string,
      destinationBranch: args.destination_branch as string || 'main',
      description: args.description as string,
      closeSourceBranch: args.close_source_branch as boolean ?? true,
    });
    return {
      id: result.id,
      title: result.title,
      state: result.state,
      url: client.extractPrUrl(result),
    };
  },

  get_pull_request: async (args) => {
    const client = getClient();
    const result = await client.getPullRequest(args.repo_slug as string, args.pr_id as number);
    if (!result) {
      return notFoundResponse('PR', `#${args.pr_id}`);
    }
    return {
      id: result.id,
      title: result.title,
      description: result.description,
      state: result.state,
      author: result.author?.display_name,
      source_branch: result.source?.branch?.name,
      destination_branch: result.destination?.branch?.name,
      reviewers: result.reviewers?.map(r => r.display_name) || [],
      url: client.extractPrUrl(result),
      created: result.created_on,
      updated: result.updated_on,
    };
  },

  list_pull_requests: async (args) => {
    const client = getClient();
    const state = (args.state as string || 'OPEN').toUpperCase();
    const validState = Object.values(PRState).includes(state as PRState) ? state : 'OPEN';
    
    const prs = await client.listPullRequests(args.repo_slug as string, {
      state: validState,
      limit: validateLimit((args.limit as number) || 20),
    });
    return {
      pull_requests: prs.map(pr => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author?.display_name,
        source_branch: pr.source?.branch?.name,
        destination_branch: pr.destination?.branch?.name,
        url: client.extractPrUrl(pr),
      })),
    };
  },

  merge_pull_request: async (args) => {
    const client = getClient();
    const strategy = (args.merge_strategy as string || 'merge_commit').toLowerCase();
    const validStrategy = Object.values(MergeStrategy).includes(strategy as MergeStrategy) ? strategy : 'merge_commit';
    
    const result = await client.mergePullRequest(args.repo_slug as string, args.pr_id as number, {
      mergeStrategy: validStrategy,
      closeSourceBranch: args.close_source_branch as boolean ?? true,
      message: args.message as string,
    });
    return {
      id: result.id,
      state: result.state,
      merge_commit: result.merge_commit?.hash,
      url: client.extractPrUrl(result),
    };
  },

  list_pr_comments: async (args) => {
    const client = getClient();
    const comments = await client.listPrComments(args.repo_slug as string, args.pr_id as number, {
      limit: validateLimit((args.limit as number) || 50),
    });
    return {
      pr_id: args.pr_id,
      comments: comments.map(c => ({
        id: c.id,
        content: c.content?.raw || '',
        author: c.user?.display_name,
        created: c.created_on,
        inline: c.inline ? { path: c.inline.path, line: c.inline.to } : undefined,
      })),
    };
  },

  add_pr_comment: async (args) => {
    const client = getClient();
    let inline: { path: string; to: number } | undefined;
    if (args.file_path && args.line) {
      inline = { path: args.file_path as string, to: args.line as number };
    }
    const result = await client.addPrComment(
      args.repo_slug as string,
      args.pr_id as number,
      args.content as string,
      inline
    );
    return {
      id: result.id,
      content: result.content?.raw || '',
      inline,
    };
  },

  approve_pr: async (args) => {
    const client = getClient();
    const result = await client.approvePr(args.repo_slug as string, args.pr_id as number);
    return {
      pr_id: args.pr_id,
      approved_by: (result as { user?: { display_name?: string } }).user?.display_name,
    };
  },

  unapprove_pr: async (args) => {
    const client = getClient();
    await client.unapprovePr(args.repo_slug as string, args.pr_id as number);
    return { pr_id: args.pr_id };
  },

  request_changes_pr: async (args) => {
    const client = getClient();
    const result = await client.requestChangesPr(args.repo_slug as string, args.pr_id as number);
    return {
      pr_id: args.pr_id,
      requested_by: (result as { user?: { display_name?: string } }).user?.display_name,
    };
  },

  decline_pr: async (args) => {
    const client = getClient();
    const result = await client.declinePr(args.repo_slug as string, args.pr_id as number);
    return {
      pr_id: args.pr_id,
      state: result.state,
    };
  },

  get_pr_diff: async (args) => {
    const client = getClient();
    const diff = await client.getPrDiff(args.repo_slug as string, args.pr_id as number);
    if (!diff) {
      return { error: `PR #${args.pr_id} not found or has no diff` };
    }
    const maxLength = 50000;
    const truncated = diff.length > maxLength;
    return {
      pr_id: args.pr_id,
      diff: truncated ? diff.substring(0, maxLength) : diff,
      truncated,
      total_length: diff.length,
    };
  },
};

