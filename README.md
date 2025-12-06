# Bitbucket MCP Server

MCP server for Bitbucket API operations. Works with Claude Code, Claude Desktop, and any MCP-compatible client.

## Features

- **Repositories**: get, create, delete, list
- **Pull Requests**: create, get, list, merge
- **Pipelines**: trigger, get status, list, view logs, stop
- **Branches**: list, get

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

**[Full Installation Guide](https://bitbucket.org/simplekyc/bitbucket-mcp/src/main/docs/INSTALLATION.md)** - Includes API token creation, permissions setup, and troubleshooting.

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

Once configured, ask Claude to:

- "List all repositories in my workspace"
- "Show me open pull requests in my-repo"
- "Create a PR from feature-branch to main"
- "Trigger a pipeline on the develop branch"
- "What's the status of the latest pipeline?"
- "Merge PR #42 using squash strategy"

## Installation Options

### From PyPI (Recommended)

```bash
pipx install mcp-server-bitbucket
# or
pip install mcp-server-bitbucket
```

### From Source

```bash
git clone https://github.com/simplekyc/bitbucket-mcp.git
cd bitbucket-mcp
poetry install
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
        "BITBUCKET_API_TOKEN": "your-api-token"
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

See the [full installation guide](https://bitbucket.org/simplekyc/bitbucket-mcp/src/main/docs/INSTALLATION.md) for detailed instructions.

## HTTP Server (Cloud Run)

For deploying as an HTTP API:

```bash
# Run locally
poetry run uvicorn src.http_server:app --reload --port 8080

# Deploy to Cloud Run
gcloud run deploy bitbucket-mcp-service \
  --source . \
  --region australia-southeast1 \
  --set-secrets "BITBUCKET_EMAIL=bitbucket-email:latest,BITBUCKET_API_TOKEN=bitbucket-token:latest"
```

## Links

- [PyPI Package](https://pypi.org/project/mcp-server-bitbucket/)
- [Installation Guide](https://bitbucket.org/simplekyc/bitbucket-mcp/src/main/docs/INSTALLATION.md)
- [Bitbucket Repository](https://bitbucket.org/simplekyc/bitbucket-mcp)

## License

MIT
