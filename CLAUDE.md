# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server for Bitbucket API operations. It provides tools for interacting with Bitbucket repositories, pull requests, pipelines, branches, commits, tags, deployments, webhooks, branch restrictions, source browsing, and permissions. The server works with Claude Code, Claude Desktop, and any MCP-compatible client.

## Development Commands

```bash
# Install dependencies
poetry install

# Run MCP server (stdio mode for Claude Desktop/Code)
poetry run python -m src.server

# Run HTTP server (for Cloud Run deployment)
poetry run uvicorn src.http_server:app --reload --port 8080

# Build and publish to PyPI
poetry build
poetry publish

# Tag a release
git tag v0.x.x && git push origin v0.x.x
```

## Architecture

The codebase has a simple two-layer architecture:

- **`src/server.py`**: FastMCP server that defines all 38 MCP tools. Each tool is a decorated function (`@mcp.tool()`) that wraps BitbucketClient methods, transforming raw API responses into cleaner dicts for LLM consumption.

- **`src/bitbucket_client.py`**: Low-level HTTP client for Bitbucket API 2.0. Uses httpx with Basic Auth. Contains all the actual API calls organized by domain (repositories, PRs, pipelines, etc.). Exposes a singleton via `get_client()`.

- **`src/http_server.py`**: FastAPI wrapper that exposes MCP tools as REST endpoints for Cloud Run deployment. Maps tool names to functions and provides convenience routes.

## Configuration

The server requires three environment variables:
- `BITBUCKET_WORKSPACE`: Bitbucket workspace slug
- `BITBUCKET_EMAIL`: Account email for Basic Auth
- `BITBUCKET_API_TOKEN`: Repository access token

## Adding New Tools

1. Add the API method to `BitbucketClient` in `src/bitbucket_client.py`
2. Create the MCP tool wrapper in `src/server.py` using `@mcp.tool()` decorator
3. If exposing via HTTP, add to the `TOOLS` dict in `src/http_server.py`

## Development Workflow

### 1. Local Testing (Direct)

Test tools directly without Claude Code by importing and calling them:

```python
# Test a tool directly
python -c "
from src.server import list_repositories
print(list_repositories(limit=5))
"

# Or test the client layer
python -c "
from src.bitbucket_client import get_client
client = get_client()
print(client.list_repositories(limit=5))
"
```

### 2. Local Testing with Claude Code

Configure Claude Code to use the local development version instead of the PyPI package:

```bash
# Remove the PyPI version if installed
claude mcp remove bitbucket

# Add the local development version
claude mcp add bitbucket -s user \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e BITBUCKET_EMAIL=your-email@example.com \
  -e BITBUCKET_API_TOKEN=your-token \
  -- poetry run --directory /path/to/bitbucket-mcp python -m src.server
```

This allows testing changes immediately without publishing.

### 3. Publishing to PyPI

```bash
# 1. Bump version in pyproject.toml

# 2. Build the package
poetry build

# 3. Publish to PyPI
poetry publish

# 4. Tag the release
git tag v0.x.x
git push origin v0.x.x
```

### 4. Verify Published Version

```bash
# Upgrade to the new version
pipx upgrade mcp-server-bitbucket

# If upgrade doesn't pick up the new version, reinstall:
pipx uninstall mcp-server-bitbucket
pipx install mcp-server-bitbucket

# Restart Claude Code session to pick up changes
# Then verify the tools are accessible
```

## Package Distribution

Published to PyPI as `mcp-server-bitbucket`. Users install via `pipx install mcp-server-bitbucket`. The entry point `mcp-server-bitbucket` runs `src.server:main`.
