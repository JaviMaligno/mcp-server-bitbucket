"""HTTP Server for Bitbucket MCP (Cloud Run deployment).

Uses MCP Streamable HTTP transport for standard MCP protocol over HTTP.
Exposes all 58 tools, 4 prompts, and 5 resources automatically.

Usage:
    # Development
    uv run uvicorn src.http_server:app --reload --port 8080

    # Production (Docker/Cloud Run)
    uv run uvicorn src.http_server:app --host 0.0.0.0 --port 8080

    # Or run directly
    uv run python -m src.http_server
"""
import os

from src.server import mcp

# ASGI app for uvicorn/gunicorn - required for Dockerfile compatibility
app = mcp.streamable_http_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    host = os.getenv("HOST", "0.0.0.0")
    mcp.run(transport="streamable-http", host=host, port=port)
