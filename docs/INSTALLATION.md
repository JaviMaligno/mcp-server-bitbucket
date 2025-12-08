# Bitbucket MCP Server - Installation Guide

Complete guide for installing and configuring the Bitbucket MCP server with Claude Code.

## Prerequisites

- Python 3.11+ or pipx installed
- Bitbucket account with API access
- Claude Code CLI installed

## Step 1: Install the Package

### Option A: Using pipx (Recommended)

```bash
pipx install mcp-server-bitbucket
```

### Option B: Using pip

```bash
pip install mcp-server-bitbucket
```

### Option C: From Source

```bash
git clone https://github.com/JaviMaligno/mcp-server-bitbucket.git
cd mcp-server-bitbucket
uv sync
```

## Step 2: Create Bitbucket API Token

Bitbucket uses **Repository Access Tokens** or **Workspace Access Tokens** for API authentication.

### Creating a Repository Access Token

1. Go to your repository in Bitbucket
2. Navigate to **Repository settings** > **Access tokens**
3. Click **Create Repository Access Token**
4. Configure the token:
   - **Name**: `Claude Code MCP` (or any descriptive name)
   - **Permissions** - select the following:
     - **Repository**: Read, Write, Admin, Delete
     - **Pull requests**: Read, Write
     - **Pipelines**: Read, Write
     - **Projects**: Read (for list_projects, get_project)
     - **Webhooks**: Read, Write (for webhook management)
5. Click **Create**
6. **Copy the token immediately** - it won't be shown again!

### Creating a Workspace Access Token (for multiple repos)

1. Go to **Workspace settings** > **Access tokens**
2. Click **Create Workspace Access Token**
3. Configure the token:
   - **Name**: `Claude Code MCP`
   - **Permissions**:
     - **Repositories**: Read, Write, Admin, Delete
     - **Pull requests**: Read, Write
     - **Pipelines**: Read, Write
     - **Projects**: Read
     - **Webhooks**: Read, Write
4. Click **Create**
5. **Copy the token immediately**

### Required Permissions Summary

| Scope | Permission | Used for |
|-------|------------|----------|
| Repositories | Read | `list_repositories`, `get_repository`, `list_branches`, `get_branch`, `list_commits`, `get_commit`, `compare_commits`, `get_commit_statuses` |
| Repositories | Write | `create_repository`, `create_commit_status` |
| Repositories | Admin | Repository settings, `update_repository` |
| Repositories | Delete | `delete_repository` |
| Pull requests | Read | `list_pull_requests`, `get_pull_request`, `list_pr_comments`, `get_pr_diff` |
| Pull requests | Write | `create_pull_request`, `merge_pull_request`, `approve_pr`, `unapprove_pr`, `request_changes_pr`, `decline_pr`, `add_pr_comment` |
| Pipelines | Read | `list_pipelines`, `get_pipeline`, `get_pipeline_logs`, `list_environments`, `get_environment`, `list_deployment_history` |
| Pipelines | Write | `trigger_pipeline`, `stop_pipeline` |
| Projects | Read | `list_projects`, `get_project` |
| Webhooks | Read | `list_webhooks`, `get_webhook` |
| Webhooks | Write | `create_webhook`, `delete_webhook` |

## Step 3: Configure Claude Code

### Option A: Using CLI Command (Recommended)

Run this command, replacing the placeholders with your values:

```bash
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

**With TOON format for ~30-40% token savings:**

```bash
claude mcp add bitbucket -s user \
  -e OUTPUT_FORMAT=toon \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -- mcp-server-bitbucket
```

**Example with real values:**

```bash
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=simplekyc \
  -e BITBUCKET_EMAIL=javier@simplekyc.com \
  -e BITBUCKET_API_TOKEN=ATATT3xFfGF0KIXKm4Si... \
  -- mcp-server-bitbucket
```

### Option B: Manual Configuration

Edit `~/.claude.json` and add to the `mcpServers` section:

```json
{
  "mcpServers": {
    "bitbucket": {
      "type": "stdio",
      "command": "mcp-server-bitbucket",
      "args": [],
      "env": {
        "BITBUCKET_WORKSPACE": "your-workspace",
        "BITBUCKET_EMAIL": "your-email@example.com",
        "BITBUCKET_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Option C: Project-level Configuration

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "mcp-server-bitbucket",
      "env": {
        "BITBUCKET_WORKSPACE": "your-workspace",
        "BITBUCKET_EMAIL": "your-email@example.com",
        "BITBUCKET_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

> **Warning:** Don't commit `.mcp.json` with credentials to version control! Add it to `.gitignore`.

## Step 4: Verify Installation

```bash
# Check MCP server is configured
claude mcp list

# Should show:
# bitbucket: ✓ Connected
```

Start a Claude Code session and test:

```
> List my Bitbucket repositories
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

### Branches & Commits
| Tool | Description |
|------|-------------|
| `list_branches` | List branches in a repo |
| `get_branch` | Get branch details |
| `list_commits` | List commits |
| `get_commit` | Get commit details |
| `compare_commits` | Compare two commits/branches |

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
| `create_branch_restriction` | Create protection rule |
| `delete_branch_restriction` | Delete protection rule |

### Source (File Browsing)
| Tool | Description |
|------|-------------|
| `get_file_content` | Read file contents |
| `list_directory` | List directory contents |

### Commit Statuses
| Tool | Description |
|------|-------------|
| `get_commit_statuses` | Get CI/CD statuses for a commit |
| `create_commit_status` | Report build status |

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
| `list_pr_comments` | List PR comments |
| `add_pr_comment` | Add a comment |
| `get_pr_diff` | Get PR diff |

### Pipelines
| Tool | Description |
|------|-------------|
| `list_pipelines` | List pipeline runs |
| `get_pipeline` | Get pipeline status |
| `get_pipeline_logs` | View pipeline logs |
| `trigger_pipeline` | Trigger a pipeline |
| `stop_pipeline` | Stop a pipeline |

### Pipeline Variables
| Tool | Description |
|------|-------------|
| `list_pipeline_variables` | List pipeline variables |
| `get_pipeline_variable` | Get variable details |
| `create_pipeline_variable` | Create a variable |
| `update_pipeline_variable` | Update variable value |
| `delete_pipeline_variable` | Delete a variable |

### Deployments
| Tool | Description |
|------|-------------|
| `list_environments` | List environments |
| `get_environment` | Get environment details |
| `list_deployment_history` | Get deployment history |

### Webhooks
| Tool | Description |
|------|-------------|
| `list_webhooks` | List webhooks |
| `create_webhook` | Create a webhook |
| `get_webhook` | Get webhook details |
| `delete_webhook` | Delete a webhook |

### Repository Permissions
| Tool | Description |
|------|-------------|
| `list_user_permissions` | List user permissions |
| `get_user_permission` | Get user's permission |
| `update_user_permission` | Add/update user permission |
| `delete_user_permission` | Remove user permission |
| `list_group_permissions` | List group permissions |
| `get_group_permission` | Get group's permission |
| `update_group_permission` | Add/update group permission |
| `delete_group_permission` | Remove group permission |

### Projects
| Tool | Description |
|------|-------------|
| `list_projects` | List projects |
| `get_project` | Get project details |

## Example Usage

Once configured, you can ask Claude to:

**Repositories & Commits:**
- "List all repositories in my workspace"
- "Search for repositories with 'api' in the name"
- "Show me the last 10 commits on main"
- "Compare develop branch with main"

**Pull Requests & Code Review:**
- "Show me open pull requests in my-repo"
- "Create a PR from feature-branch to main"
- "Approve PR #42"
- "Add a comment to PR #15"
- "Show me the diff for PR #42"
- "Merge PR #42 using squash strategy"

**Pipelines & CI/CD:**
- "Trigger a pipeline on develop"
- "What's the status of the latest pipeline?"
- "Get build status for commit abc123"

**Deployments:**
- "List deployment environments"
- "Show deployment history for production"

**Webhooks:**
- "List webhooks for my-repo"
- "Create a webhook for push events"

**Tags:**
- "List all tags in my-repo"
- "Create a tag v1.0.0 on main"
- "Delete the old-release tag"

**Branch Protection:**
- "List branch restrictions for my-repo"
- "Require 2 approvals to merge to main"

**Source Browsing:**
- "Show me the contents of src/main.py"
- "List files in the root directory"

**Repository Permissions:**
- "List user permissions for my-repo"
- "Give write access to user@example.com"
- "List group permissions"

### Repository Search

The `list_repositories` tool supports flexible searching:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `search` | Simple fuzzy name search | `search="api"` finds repos with "api" in name |
| `query` | Advanced Bitbucket query syntax | `query='name ~ "test" AND is_private = true'` |
| `project_key` | Filter by project | `project_key="MYPROJECT"` |

Query syntax: `name ~ "term"`, `description ~ "term"`, `is_private = true/false`, combined with `AND`/`OR`

## Quick Reference: CLI Command

Copy and customize this command:

```bash
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=<workspace> \
  -e BITBUCKET_EMAIL=<email> \
  -e BITBUCKET_API_TOKEN=<token> \
  -- mcp-server-bitbucket
```

Where:
- `<workspace>` - Your Bitbucket workspace slug (e.g., `simplekyc`)
- `<email>` - Your Bitbucket account email
- `<token>` - The API token you created in Step 2

### Output Format Options

| Variable | Values | Description |
|----------|--------|-------------|
| `OUTPUT_FORMAT` | `json` (default), `toon` | Response format. TOON saves ~30-40% tokens |

Add `-e OUTPUT_FORMAT=toon` for token-optimized responses.

## Troubleshooting

### 401 Unauthorized Error

- Verify your API token is correct and hasn't expired
- Check that the token has the required permissions
- Ensure BITBUCKET_EMAIL matches your Bitbucket account email
- For workspace tokens, ensure the workspace slug is correct

### 403 Forbidden Error

- The token is missing required permissions
- Go back to Bitbucket and add the missing permission scopes

### MCP Server Not Connecting

```bash
# Check server status
claude mcp get bitbucket

# Verify pipx installation
which mcp-server-bitbucket

# Test server directly
mcp-server-bitbucket
# Should output nothing (waiting for MCP protocol messages)
# Press Ctrl+C to exit
```

### Configuration Priority

Claude Code loads MCP configs in this order (later overrides earlier):

1. User config: `~/.claude.json`
2. Project config: `.mcp.json` in project root

If you have both, the project config takes precedence. Remove project `.mcp.json` if you want to use user config.

## Updating

```bash
# Update to latest version
pipx upgrade mcp-server-bitbucket

# Or reinstall for clean update
pipx uninstall mcp-server-bitbucket && pipx install mcp-server-bitbucket
```

## Uninstalling

```bash
# Remove from Claude Code
claude mcp remove bitbucket -s user

# Uninstall package
pipx uninstall mcp-server-bitbucket
```

## Support

- GitHub Issues: https://github.com/JaviMaligno/mcp-server-bitbucket/issues
- PyPI: https://pypi.org/project/mcp-server-bitbucket/
