/**
 * MCP Resources for Bitbucket Server
 */

import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from './client.js';

/**
 * Resource definitions for the MCP server
 */
export const resourceDefinitions: Resource[] = [
  {
    uri: 'bitbucket://repositories',
    name: 'Repositories',
    description: 'List all repositories in the workspace',
    mimeType: 'text/markdown',
  },
  {
    uri: 'bitbucket://repositories/{repo_slug}',
    name: 'Repository Details',
    description: 'Get detailed information about a specific repository',
    mimeType: 'text/markdown',
  },
  {
    uri: 'bitbucket://repositories/{repo_slug}/branches',
    name: 'Repository Branches',
    description: 'List branches in a repository',
    mimeType: 'text/markdown',
  },
  {
    uri: 'bitbucket://repositories/{repo_slug}/pull-requests',
    name: 'Pull Requests',
    description: 'List open pull requests in a repository',
    mimeType: 'text/markdown',
  },
  {
    uri: 'bitbucket://projects',
    name: 'Projects',
    description: 'List all projects in the workspace',
    mimeType: 'text/markdown',
  },
];

/**
 * Handle resource read requests
 */
export async function handleResourceRead(uri: string): Promise<string> {
  const client = getClient();

  // Parse the URI to extract parameters
  if (uri === 'bitbucket://repositories') {
    return await resourceRepositories(client);
  }
  
  if (uri === 'bitbucket://projects') {
    return await resourceProjects(client);
  }

  // Match repository-specific URIs
  const repoMatch = uri.match(/^bitbucket:\/\/repositories\/([^/]+)$/);
  if (repoMatch) {
    return await resourceRepository(client, repoMatch[1]);
  }

  const branchesMatch = uri.match(/^bitbucket:\/\/repositories\/([^/]+)\/branches$/);
  if (branchesMatch) {
    return await resourceBranches(client, branchesMatch[1]);
  }

  const prsMatch = uri.match(/^bitbucket:\/\/repositories\/([^/]+)\/pull-requests$/);
  if (prsMatch) {
    return await resourcePullRequests(client, prsMatch[1]);
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

async function resourceRepositories(client: ReturnType<typeof getClient>): Promise<string> {
  const repos = await client.listRepositories({ limit: 50 });
  const lines = [`# Repositories in ${client.workspace}`, ''];
  
  for (const r of repos) {
    const name = r.name || 'unknown';
    const desc = (r.description || '').substring(0, 50) || 'No description';
    const icon = r.is_private ? '🔒' : '🌐';
    lines.push(`- ${icon} **${name}**: ${desc}`);
  }
  
  return lines.join('\n');
}

async function resourceRepository(client: ReturnType<typeof getClient>, repoSlug: string): Promise<string> {
  const repo = await client.getRepository(repoSlug);
  if (!repo) {
    return `Repository '${repoSlug}' not found`;
  }

  const lines = [
    `# ${repo.name || repoSlug}`,
    '',
    `**Description**: ${repo.description || 'No description'}`,
    `**Private**: ${repo.is_private ? 'Yes' : 'No'}`,
    `**Project**: ${repo.project?.name || 'None'}`,
    `**Main branch**: ${repo.mainbranch?.name || 'main'}`,
    '',
    '## Clone URLs',
  ];
  
  for (const clone of repo.links?.clone || []) {
    lines.push(`- ${clone.name}: \`${clone.href}\``);
  }

  return lines.join('\n');
}

async function resourceBranches(client: ReturnType<typeof getClient>, repoSlug: string): Promise<string> {
  const branches = await client.listBranches(repoSlug, { limit: 30 });
  const lines = [`# Branches in ${repoSlug}`, ''];
  
  for (const b of branches) {
    const name = b.name || 'unknown';
    const commit = (b.target?.hash || '').substring(0, 7);
    lines.push(`- **${name}** (${commit})`);
  }
  
  return lines.join('\n');
}

async function resourcePullRequests(client: ReturnType<typeof getClient>, repoSlug: string): Promise<string> {
  const prs = await client.listPullRequests(repoSlug, { state: 'OPEN', limit: 20 });
  const lines = [`# Open Pull Requests in ${repoSlug}`, ''];
  
  if (prs.length === 0) {
    lines.push('No open pull requests');
  }
  
  for (const pr of prs) {
    const prId = pr.id;
    const title = pr.title || 'Untitled';
    const author = pr.author?.display_name || 'Unknown';
    lines.push(`- **#${prId}**: ${title} (by ${author})`);
  }
  
  return lines.join('\n');
}

async function resourceProjects(client: ReturnType<typeof getClient>): Promise<string> {
  const projects = await client.listProjects({ limit: 50 });
  const lines = [`# Projects in ${client.workspace}`, ''];
  
  for (const p of projects) {
    const key = p.key || '?';
    const name = p.name || 'Unknown';
    const desc = (p.description || '').substring(0, 40) || 'No description';
    lines.push(`- **${key}** - ${name}: ${desc}`);
  }
  
  return lines.join('\n');
}

