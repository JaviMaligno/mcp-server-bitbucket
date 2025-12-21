# Dockerfile for Smithery deployment
FROM python:3.11-slim

# Install the MCP server from PyPI
RUN pip install --no-cache-dir mcp-server-bitbucket

# Set the entrypoint
ENTRYPOINT ["mcp-server-bitbucket"]
