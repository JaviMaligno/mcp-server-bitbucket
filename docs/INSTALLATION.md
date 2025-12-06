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
git clone https://github.com/simplekyc/bitbucket-mcp.git
cd bitbucket-mcp
poetry install
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
4. Click **Create**
5. **Copy the token immediately**

### Required Permissions Summary

| Scope | Permission | Used for |
|-------|------------|----------|
| Repositories | Read | `list_repositories`, `get_repository`, `list_branches`, `get_branch` |
| Repositories | Write | `create_repository` |
| Repositories | Admin | Repository settings |
| Repositories | Delete | `delete_repository` |
| Pull requests | Read | `list_pull_requests`, `get_pull_request` |
| Pull requests | Write | `create_pull_request`, `merge_pull_request` |
| Pipelines | Read | `list_pipelines`, `get_pipeline`, `get_pipeline_logs` |
| Pipelines | Write | `trigger_pipeline`, `stop_pipeline` |

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

## Available Tools

| Tool | Description |
|------|-------------|
| `list_repositories` | List repositories in workspace |
| `get_repository` | Get repository details |
| `create_repository` | Create a new repository |
| `delete_repository` | Delete a repository |
| `list_branches` | List branches in a repo |
| `get_branch` | Get branch details |
| `list_pull_requests` | List PRs (open, merged, etc.) |
| `get_pull_request` | Get PR details |
| `create_pull_request` | Create a new PR |
| `merge_pull_request` | Merge a PR |
| `list_pipelines` | List recent pipeline runs |
| `get_pipeline` | Get pipeline status |
| `get_pipeline_logs` | View pipeline logs |
| `trigger_pipeline` | Trigger a pipeline run |
| `stop_pipeline` | Stop a running pipeline |

## Example Usage

Once configured, you can ask Claude to:

- "List all repositories in my workspace"
- "Search for repositories with 'api' in the name"
- "Find all private repos containing 'test'"
- "Show me open pull requests in anzsic_classifier"
- "Create a PR from feature-branch to main with title 'Add new feature'"
- "Trigger a pipeline on the develop branch"
- "What's the status of the latest pipeline?"
- "Show me the logs for the failed pipeline step"
- "Merge PR #42 using squash strategy"

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

- Bitbucket Issues: https://bitbucket.org/simplekyc/bitbucket-mcp/issues
- PyPI: https://pypi.org/project/mcp-server-bitbucket/
