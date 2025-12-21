/**
 * MCP Prompts for Bitbucket Server
 */

import { Prompt, GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * Prompt definitions for the MCP server
 */
export const promptDefinitions: Prompt[] = [
  {
    name: 'code_review',
    description: 'Generate a code review prompt for a pull request',
    arguments: [
      {
        name: 'repo_slug',
        description: 'Repository slug',
        required: true,
      },
      {
        name: 'pr_id',
        description: 'Pull request ID',
        required: true,
      },
    ],
  },
  {
    name: 'release_notes',
    description: 'Generate release notes from commits between two refs',
    arguments: [
      {
        name: 'repo_slug',
        description: 'Repository slug',
        required: true,
      },
      {
        name: 'base_tag',
        description: 'Base tag or commit (e.g., "v1.0.0")',
        required: true,
      },
      {
        name: 'head',
        description: 'Head ref (default: "main")',
        required: false,
      },
    ],
  },
  {
    name: 'pipeline_debug',
    description: 'Debug a failed pipeline',
    arguments: [
      {
        name: 'repo_slug',
        description: 'Repository slug',
        required: true,
      },
    ],
  },
  {
    name: 'repo_summary',
    description: 'Get a comprehensive summary of a repository',
    arguments: [
      {
        name: 'repo_slug',
        description: 'Repository slug',
        required: true,
      },
    ],
  },
];

/**
 * Handle prompt get requests
 */
export function handlePromptGet(
  name: string,
  args: Record<string, string>
): GetPromptResult {
  switch (name) {
    case 'code_review':
      return promptCodeReview(args.repo_slug, args.pr_id);
    case 'release_notes':
      return promptReleaseNotes(args.repo_slug, args.base_tag, args.head || 'main');
    case 'pipeline_debug':
      return promptPipelineDebug(args.repo_slug);
    case 'repo_summary':
      return promptRepoSummary(args.repo_slug);
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

function promptCodeReview(repoSlug: string, prId: string): GetPromptResult {
  const content = `Please review pull request #${prId} in repository '${repoSlug}'.

Use the following tools to gather information:
1. get_pull_request(repo_slug="${repoSlug}", pr_id=${prId}) - Get PR details
2. get_pr_diff(repo_slug="${repoSlug}", pr_id=${prId}) - Get the code changes
3. list_pr_comments(repo_slug="${repoSlug}", pr_id=${prId}) - See existing comments

Then provide a thorough code review covering:
- Code quality and readability
- Potential bugs or edge cases
- Security concerns
- Performance considerations
- Suggestions for improvement

If you find issues, use add_pr_comment() to leave feedback on specific lines.`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: content,
        },
      },
    ],
  };
}

function promptReleaseNotes(repoSlug: string, baseTag: string, head: string): GetPromptResult {
  const content = `Generate release notes for repository '${repoSlug}' comparing ${baseTag} to ${head}.

Use these tools:
1. compare_commits(repo_slug="${repoSlug}", base="${baseTag}", head="${head}") - See changed files
2. list_commits(repo_slug="${repoSlug}", branch="${head}", limit=50) - Get recent commits

Organize the release notes into sections:
- **New Features**: New functionality added
- **Bug Fixes**: Issues that were resolved
- **Improvements**: Enhancements to existing features
- **Breaking Changes**: Changes that require user action

Format as markdown suitable for a GitHub/Bitbucket release.`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: content,
        },
      },
    ],
  };
}

function promptPipelineDebug(repoSlug: string): GetPromptResult {
  const content = `Help debug pipeline failures in repository '${repoSlug}'.

Use these tools:
1. list_pipelines(repo_slug="${repoSlug}", limit=5) - Get recent pipeline runs
2. get_pipeline(repo_slug="${repoSlug}", pipeline_uuid="<uuid>") - Get pipeline details
3. get_pipeline_logs(repo_slug="${repoSlug}", pipeline_uuid="<uuid>") - Get step list
4. get_pipeline_logs(repo_slug="${repoSlug}", pipeline_uuid="<uuid>", step_uuid="<step>") - Get logs

Analyze the failures and provide:
- Root cause of the failure
- Specific error messages
- Recommended fixes
- Commands to re-run the pipeline if appropriate`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: content,
        },
      },
    ],
  };
}

function promptRepoSummary(repoSlug: string): GetPromptResult {
  const content = `Provide a comprehensive summary of repository '${repoSlug}'.

Gather information using:
1. get_repository(repo_slug="${repoSlug}") - Basic repo info
2. list_branches(repo_slug="${repoSlug}", limit=10) - Active branches
3. list_pull_requests(repo_slug="${repoSlug}", state="OPEN") - Open PRs
4. list_pipelines(repo_slug="${repoSlug}", limit=5) - Recent CI/CD status
5. list_commits(repo_slug="${repoSlug}", limit=10) - Recent activity

Summarize:
- Repository description and purpose
- Current development activity
- Open pull requests needing attention
- CI/CD health
- Recent contributors`;

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: content,
        },
      },
    ],
  };
}

