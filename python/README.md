# Bitbucket MCP Server

<!-- mcp-name: io.github.JaviMaligno/bitbucket -->

[![CI/CD](https://github.com/JaviMaligno/mcp-server-bitbucket/actions/workflows/ci.yml/badge.svg)](https://github.com/JaviMaligno/mcp-server-bitbucket/actions/workflows/ci.yml)
[![PyPI version](https://badge.fury.io/py/mcp-server-bitbucket.svg)](https://pypi.org/project/mcp-server-bitbucket/)
[![npm version](https://badge.fury.io/js/mcp-server-bitbucket.svg)](https://www.npmjs.com/package/mcp-server-bitbucket)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for Bitbucket API operations. Works with Claude Code, Claude Desktop, Cursor, and any MCP-compatible client.

## Language Versions

This repository contains both **TypeScript** and **Python** implementations:

| Version | Directory | Status | Installation |
|---------|-----------|--------|--------------|
| **TypeScript** | `/typescript` | ✅ Recommended (Smithery) | `npm install -g mcp-server-bitbucket` |
| Python | `/python` | ✅ Stable | `pipx install mcp-server-bitbucket` |

> **Note**: The TypeScript version is used for Smithery deployments. Both versions provide identical functionality.

## Features

- **Repositories**: get, create, delete, list, update (move to project, rename)
- **Pull Requests**: create, get, list, merge, approve, decline, request changes, comments, diff
- **Pipelines**: trigger, get status, list, view logs, stop
- **Branches**: list, get
- **Projects**: list, get
- **Commits**: list, get details, compare/diff between branches
- **Commit Statuses**: get build statuses, create status (CI/CD integration)
- **Deployments**: list environments, get environment details, deployment history
- **Webhooks**: list, create, get, delete
- **Tags**: list, create, delete
- **Branch Restrictions**: list, create, delete branch protection rules
- **Source Browsing**: read files, list directories without cloning
- **Repository Permissions**: manage user and group permissions
- **Pipeline Variables**: manage CI/CD environment variables
- **MCP Prompts**: reusable workflow templates (code review, release notes, etc.)
- **MCP Resources**: browsable workspace data

## Quick Start

### TypeScript (Recommended for Smithery)

```bash
# Install globally
npm install -g mcp-server-bitbucket

# Or run directly with npx
npx mcp-server-bitbucket
```

### Python

```bash
# Install with pipx
pipx install mcp-server-bitbucket

# Configure Claude Code
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

**[Full Installation Guide](https://github.com/JaviMaligno/mcp-server-bitbucket/blob/main/docs/INSTALLATION.md)** - Includes API token creation, permissions setup, and troubleshooting.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BITBUCKET_WORKSPACE` | ✅ | Bitbucket workspace slug |
| `BITBUCKET_EMAIL` | ✅ | Account email for Basic Auth |
| `BITBUCKET_API_TOKEN` | ✅ | Repository access token |
| `API_TIMEOUT` | | Request timeout in seconds (default: 30) |
| `MAX_RETRIES` | | Max retry attempts for rate limiting (default: 3) |

### Claude Code CLI

```bash
# TypeScript version
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- npx mcp-server-bitbucket

# Python version
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

### Cursor IDE

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["mcp-server-bitbucket"],
      "env": {
        "BITBUCKET_WORKSPACE": "your-workspace",
        "BITBUCKET_EMAIL": "your-email@example.com",
        "BITBUCKET_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Available Tools (58 total)

### Repositories
| Tool | Description |
|------|-------------|
| `list_repositories` | List and search repositories |
| `get_repository` | Get repository details |
| `create_repository` | Create a new repository |
| `delete_repository` | Delete a repository |
| `update_repository` | Update repo settings |

### Pull Requests
| Tool | Description |
|------|-------------|
| `list_pull_requests` | List PRs |
| `get_pull_request` | Get PR details |
| `create_pull_request` | Create a new PR |
| `merge_pull_request` | Merge a PR |
| `approve_pr` | Approve a PR |
| `unapprove_pr` | Remove approval |
| `request_changes_pr` | Request changes |
| `decline_pr` | Decline a PR |
| `list_pr_comments` | List comments |
| `add_pr_comment` | Add comment |
| `get_pr_diff` | Get the diff |

### Pipelines
| Tool | Description |
|------|-------------|
| `list_pipelines` | List recent runs |
| `get_pipeline` | Get status |
| `get_pipeline_logs` | View logs |
| `trigger_pipeline` | Trigger a run |
| `stop_pipeline` | Stop pipeline |
| `list_pipeline_variables` | List variables |
| `get_pipeline_variable` | Get variable |
| `create_pipeline_variable` | Create variable |
| `update_pipeline_variable` | Update variable |
| `delete_pipeline_variable` | Delete variable |

### Branches, Commits, Tags
| Tool | Description |
|------|-------------|
| `list_branches` | List branches |
| `get_branch` | Get branch details |
| `list_commits` | List commits |
| `get_commit` | Get commit details |
| `compare_commits` | Compare branches |
| `get_commit_statuses` | Get build statuses |
| `create_commit_status` | Report CI status |
| `list_tags` | List tags |
| `create_tag` | Create a tag |
| `delete_tag` | Delete a tag |

### And more...
- Deployments: `list_environments`, `get_environment`, `list_deployment_history`
- Webhooks: `list_webhooks`, `create_webhook`, `get_webhook`, `delete_webhook`
- Branch Restrictions: `list_branch_restrictions`, `create_branch_restriction`, `delete_branch_restriction`
- Source Browsing: `get_file_content`, `list_directory`
- Permissions: User and group permission management (8 tools)
- Projects: `list_projects`, `get_project`

## MCP Prompts

Reusable workflow templates:

| Prompt | Description |
|--------|-------------|
| `code_review` | Comprehensive PR code review |
| `release_notes` | Generate changelog between versions |
| `pipeline_debug` | Debug failed CI/CD pipelines |
| `repo_summary` | Complete repository status overview |

## MCP Resources

Browsable workspace data:

| Resource URI | Description |
|--------------|-------------|
| `bitbucket://repositories` | List all repos |
| `bitbucket://repositories/{repo}` | Repository details |
| `bitbucket://repositories/{repo}/branches` | Branch list |
| `bitbucket://repositories/{repo}/pull-requests` | Open PRs |
| `bitbucket://projects` | List all projects |

## Development

### TypeScript

```bash
cd typescript
npm install
npm run build
npm run dev  # Watch mode
```

### Python

```bash
cd python
uv sync
uv run python -m src.server
```

## Creating a Bitbucket API Token

1. Go to your repository in Bitbucket
2. Navigate to **Repository settings** > **Access tokens**
3. Click **Create Repository Access Token**
4. Select permissions:
   - **Repository**: Read, Write, Admin, Delete
   - **Pull requests**: Read, Write
   - **Pipelines**: Read, Write
5. Copy the token immediately

## License

MIT
