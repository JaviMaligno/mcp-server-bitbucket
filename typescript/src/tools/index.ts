/**
 * Tool definitions and handlers for Bitbucket MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from '../client.js';
import { validateLimit, notFoundResponse, truncateHash, sanitizeSearchTerm } from '../utils.js';
import { PRState, MergeStrategy, CommitStatusState } from '../types.js';

// Import tool handlers from separate files
import * as repositoryTools from './repositories.js';
import * as pullRequestTools from './pull-requests.js';
import * as pipelineTools from './pipelines.js';
import * as branchTools from './branches.js';
import * as commitTools from './commits.js';
import * as deploymentTools from './deployments.js';
import * as webhookTools from './webhooks.js';
import * as tagTools from './tags.js';
import * as restrictionTools from './restrictions.js';
import * as sourceTools from './source.js';
import * as permissionTools from './permissions.js';
import * as projectTools from './projects.js';

/**
 * All tool definitions for the MCP server
 */
export const toolDefinitions: Tool[] = [
  // Repository tools
  ...repositoryTools.definitions,
  // Pull request tools
  ...pullRequestTools.definitions,
  // Pipeline tools
  ...pipelineTools.definitions,
  // Branch tools
  ...branchTools.definitions,
  // Commit tools
  ...commitTools.definitions,
  // Deployment tools
  ...deploymentTools.definitions,
  // Webhook tools
  ...webhookTools.definitions,
  // Tag tools
  ...tagTools.definitions,
  // Branch restriction tools
  ...restrictionTools.definitions,
  // Source browsing tools
  ...sourceTools.definitions,
  // Permission tools
  ...permissionTools.definitions,
  // Project tools
  ...projectTools.definitions,
];

/**
 * Handle tool calls by routing to the appropriate handler
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Repository tools
  if (name in repositoryTools.handlers) {
    return await repositoryTools.handlers[name as keyof typeof repositoryTools.handlers](args);
  }
  // Pull request tools
  if (name in pullRequestTools.handlers) {
    return await pullRequestTools.handlers[name as keyof typeof pullRequestTools.handlers](args);
  }
  // Pipeline tools
  if (name in pipelineTools.handlers) {
    return await pipelineTools.handlers[name as keyof typeof pipelineTools.handlers](args);
  }
  // Branch tools
  if (name in branchTools.handlers) {
    return await branchTools.handlers[name as keyof typeof branchTools.handlers](args);
  }
  // Commit tools
  if (name in commitTools.handlers) {
    return await commitTools.handlers[name as keyof typeof commitTools.handlers](args);
  }
  // Deployment tools
  if (name in deploymentTools.handlers) {
    return await deploymentTools.handlers[name as keyof typeof deploymentTools.handlers](args);
  }
  // Webhook tools
  if (name in webhookTools.handlers) {
    return await webhookTools.handlers[name as keyof typeof webhookTools.handlers](args);
  }
  // Tag tools
  if (name in tagTools.handlers) {
    return await tagTools.handlers[name as keyof typeof tagTools.handlers](args);
  }
  // Branch restriction tools
  if (name in restrictionTools.handlers) {
    return await restrictionTools.handlers[name as keyof typeof restrictionTools.handlers](args);
  }
  // Source browsing tools
  if (name in sourceTools.handlers) {
    return await sourceTools.handlers[name as keyof typeof sourceTools.handlers](args);
  }
  // Permission tools
  if (name in permissionTools.handlers) {
    return await permissionTools.handlers[name as keyof typeof permissionTools.handlers](args);
  }
  // Project tools
  if (name in projectTools.handlers) {
    return await projectTools.handlers[name as keyof typeof projectTools.handlers](args);
  }

  throw new Error(`Unknown tool: ${name}`);
}

