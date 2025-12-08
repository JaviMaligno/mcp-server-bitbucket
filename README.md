# Bitbucket MCP Server

[![CI/CD](https://github.com/JaviMaligno/mcp-server-bitbucket/actions/workflows/ci.yml/badge.svg)](https://github.com/JaviMaligno/mcp-server-bitbucket/actions/workflows/ci.yml)
[![PyPI version](https://badge.fury.io/py/mcp-server-bitbucket.svg)](https://pypi.org/project/mcp-server-bitbucket/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for Bitbucket API operations. Works with Claude Code, Claude Desktop, and any MCP-compatible client.

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

```bash
# Install
pipx install mcp-server-bitbucket

# Configure Claude Code
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

**[Full Installation Guide](https://github.com/JaviMaligno/mcp-server-bitbucket/blob/main/docs/INSTALLATION.md)** - Includes API token creation, permissions setup, and troubleshooting.

## Available Tools (58 total)

### Repositories
| Tool | Description |
|------|-------------|
| `list_repositories` | List and search repositories (supports fuzzy name matching) |
| `get_repository` | Get repository details |
| `create_repository` | Create a new repository |
| `delete_repository` | Delete a repository |
| `update_repository` | Update repo settings (project, visibility, description, name) |

### Branches & Commits
| Tool | Description |
|------|-------------|
| `list_branches` | List branches in a repo |
| `get_branch` | Get branch details |
| `list_commits` | List commits (filter by branch or file path) |
| `get_commit` | Get commit details |
| `compare_commits` | Compare two commits/branches (diff stats) |

### Tags
| Tool | Description |
|------|-------------|
| `list_tags` | List tags in a repo |
| `create_tag` | Create a new tag |
| `delete_tag` | Delete a tag |

### Branch Restrictions
| Tool | Description |
|------|-------------|
| `list_branch_restrictions` | List branch protection rules |
| `create_branch_restriction` | Create branch protection rule |
| `delete_branch_restriction` | Delete branch protection rule |

### Source (File Browsing)
| Tool | Description |
|------|-------------|
| `get_file_content` | Read file contents without cloning |
| `list_directory` | List directory contents |

### Commit Statuses (CI/CD)
| Tool | Description |
|------|-------------|
| `get_commit_statuses` | Get build/CI statuses for a commit |
| `create_commit_status` | Report build status from external CI |

### Pull Requests
| Tool | Description |
|------|-------------|
| `list_pull_requests` | List PRs (open, merged, etc.) |
| `get_pull_request` | Get PR details |
| `create_pull_request` | Create a new PR |
| `merge_pull_request` | Merge a PR |
| `approve_pr` | Approve a PR |
| `unapprove_pr` | Remove approval from a PR |
| `request_changes_pr` | Request changes on a PR |
| `decline_pr` | Decline (close) a PR |
| `list_pr_comments` | List comments on a PR |
| `add_pr_comment` | Add comment to a PR (general or inline) |
| `get_pr_diff` | Get the diff of a PR |

### Pipelines
| Tool | Description |
|------|-------------|
| `list_pipelines` | List recent pipeline runs |
| `get_pipeline` | Get pipeline status |
| `get_pipeline_logs` | View pipeline logs |
| `trigger_pipeline` | Trigger a pipeline run |
| `stop_pipeline` | Stop a running pipeline |

### Pipeline Variables
| Tool | Description |
|------|-------------|
| `list_pipeline_variables` | List pipeline variables for a repo |
| `get_pipeline_variable` | Get variable details |
| `create_pipeline_variable` | Create a new pipeline variable |
| `update_pipeline_variable` | Update variable value |
| `delete_pipeline_variable` | Delete a pipeline variable |

### Deployments
| Tool | Description |
|------|-------------|
| `list_environments` | List deployment environments (test, staging, prod) |
| `get_environment` | Get environment details |
| `list_deployment_history` | Get deployment history for an environment |

### Webhooks
| Tool | Description |
|------|-------------|
| `list_webhooks` | List configured webhooks |
| `create_webhook` | Create a new webhook |
| `get_webhook` | Get webhook details |
| `delete_webhook` | Delete a webhook |

### Repository Permissions
| Tool | Description |
|------|-------------|
| `list_user_permissions` | List user permissions for a repo |
| `get_user_permission` | Get specific user's permission |
| `update_user_permission` | Add/update user permission |
| `delete_user_permission` | Remove user permission |
| `list_group_permissions` | List group permissions for a repo |
| `get_group_permission` | Get specific group's permission |
| `update_group_permission` | Add/update group permission |
| `delete_group_permission` | Remove group permission |

### Projects
| Tool | Description |
|------|-------------|
| `list_projects` | List projects in workspace |
| `get_project` | Get project details |

## MCP Prompts

Reusable workflow templates that guide Claude through common tasks:

| Prompt | Description |
|--------|-------------|
| `code_review` | Comprehensive PR code review |
| `release_notes` | Generate changelog between versions |
| `pipeline_debug` | Debug failed CI/CD pipelines |
| `repo_summary` | Complete repository status overview |

## MCP Resources

Browsable workspace data as markdown:

| Resource URI | Description |
|--------------|-------------|
| `bitbucket://repositories` | List all repos in workspace |
| `bitbucket://repositories/{repo}` | Repository details |
| `bitbucket://repositories/{repo}/branches` | Branch list |
| `bitbucket://repositories/{repo}/pull-requests` | Open PRs |
| `bitbucket://projects` | List all projects |

## Example Usage

Once configured, ask Claude to:

**Repositories & Branches:**
- "List all repositories in my workspace"
- "Search for repositories with 'api' in the name"
- "Show me the last 10 commits on the main branch"
- "Compare develop branch with main"

**Pull Requests & Code Review:**
- "Show me open pull requests in my-repo"
- "Create a PR from feature-branch to main"
- "Approve PR #42"
- "Add a comment to PR #15 saying 'Looks good!'"
- "Show me the diff for PR #42"
- "Merge PR #42 using squash strategy"

**Pipelines & CI/CD:**
- "Trigger a pipeline on the develop branch"
- "What's the status of the latest pipeline?"
- "Get the build status for commit abc123"

**Deployments:**
- "List deployment environments for my-repo"
- "Show deployment history for production"

**Webhooks:**
- "List webhooks configured for my-repo"
- "Create a webhook for push events"

**Tags:**
- "List all tags in my-repo"
- "Create a tag v1.0.0 on the main branch"
- "Delete the old-release tag"

**Branch Protection:**
- "List branch restrictions for my-repo"
- "Require 2 approvals to merge to main"
- "Prevent force push to production branches"

**Source Browsing:**
- "Show me the contents of src/main.py"
- "List files in the root directory"
- "Read the README.md from the develop branch"

**Repository Permissions:**
- "List user permissions for my-repo"
- "Give user@example.com write access to my-repo"
- "List group permissions for my-repo"
- "Grant admin access to the DevOps group"

### Repository Search

The `list_repositories` tool supports flexible searching:

```python
# Simple fuzzy search by name
list_repositories(search="api")  # Finds repos with "api" in name

# Advanced Bitbucket query syntax
list_repositories(query='name ~ "test" AND is_private = true')

# Filter by project
list_repositories(project_key="MYPROJECT")
```

Query syntax supports: `name ~ "term"`, `is_private = true/false`, `AND`, `OR`

## Installation Options

### From PyPI (Recommended)

```bash
pipx install mcp-server-bitbucket
# or
pip install mcp-server-bitbucket
```

### Updating

```bash
# Upgrade to latest version
pipx upgrade mcp-server-bitbucket

# If upgrade doesn't pick up the new version, reinstall:
pipx uninstall mcp-server-bitbucket
pipx install mcp-server-bitbucket
```

### From Source

```bash
git clone https://github.com/JaviMaligno/mcp-server-bitbucket.git
cd mcp-server-bitbucket
uv sync
```

## Configuration

### Claude Code CLI (Recommended)

```bash
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

### Output Format (Optional)

Set `OUTPUT_FORMAT` to optimize token usage:

```bash
# TOON format for ~30-40% token savings
claude mcp add bitbucket -s user \
  -e OUTPUT_FORMAT=toon \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

| Format | Description | Use case |
|--------|-------------|----------|
| `json` (default) | Standard JSON | Maximum compatibility, debugging |
| `toon` | [TOON format](https://toonformat.dev/) | High-volume usage, token cost optimization |

### Manual Configuration

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "mcp-server-bitbucket",
      "env": {
        "BITBUCKET_WORKSPACE": "your-workspace",
        "BITBUCKET_EMAIL": "your-email@example.com",
        "BITBUCKET_API_TOKEN": "your-api-token",
        "OUTPUT_FORMAT": "json"
      }
    }
  }
}
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

See the [full installation guide](https://github.com/JaviMaligno/mcp-server-bitbucket/blob/main/docs/INSTALLATION.md) for detailed instructions.

## HTTP Server (Cloud Run)

For deploying as an HTTP API:

```bash
# Run locally
uv run uvicorn src.http_server:app --reload --port 8080

# Deploy to Cloud Run
gcloud run deploy bitbucket-mcp-service \
  --source . \
  --region australia-southeast1 \
  --set-secrets "BITBUCKET_EMAIL=bitbucket-email:latest,BITBUCKET_API_TOKEN=bitbucket-token:latest"
```

## Development

### Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) for dependency management
- [PyPI account](https://pypi.org/account/register/) for publishing

### Setup

```bash
git clone https://github.com/JaviMaligno/mcp-server-bitbucket.git
cd mcp-server-bitbucket
uv sync
```

### Running Locally

```bash
# MCP server (stdio mode)
uv run python -m src.server

# HTTP server
uv run uvicorn src.http_server:app --reload --port 8080
```

### CI/CD Pipeline

The project uses GitHub Actions for automated testing and publishing:

- **Every push to main**: Runs tests with coverage
- **Pull requests**: Runs full test suite
- **Tags (`v*`)**: Tests, builds, and publishes to PyPI

To release a new version:
```bash
# 1. Bump version in pyproject.toml
# 2. Commit changes
git add -A && git commit -m "release: v0.x.x"
git push origin main

# 3. Create and push tag (triggers PyPI publish)
git tag v0.x.x
git push origin v0.x.x
```

### Manual Publishing

If you need to publish manually:

1. **Get a PyPI API Token**:
   - Go to https://pypi.org/manage/account/token/
   - Create a token with scope "Entire account" (first time) or project-specific
   - Set environment variable: `export UV_PUBLISH_TOKEN=pypi-YOUR_TOKEN`

2. **Build and publish**:
   ```bash
   uv build
   uv publish
   ```

## Links

- [PyPI Package](https://pypi.org/project/mcp-server-bitbucket/)
- [Installation Guide](https://github.com/JaviMaligno/mcp-server-bitbucket/blob/main/docs/INSTALLATION.md)
- [GitHub Repository](https://github.com/JaviMaligno/mcp-server-bitbucket)

## License

MIT
