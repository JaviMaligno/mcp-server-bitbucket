"""HTTP Server for Bitbucket MCP (Cloud Run deployment).

Provides a REST API wrapper around the MCP tools for deployment
to Google Cloud Run.

Usage:
    uvicorn src.http_server:app --host 0.0.0.0 --port 8080
"""
import json
import logging
import os
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.bitbucket_client import get_client, BitbucketError
from src import server as mcp_server

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Bitbucket MCP HTTP Server",
    description="REST API for Bitbucket operations",
    version="0.1.0",
)

# CORS configuration
# In production, set ALLOWED_ORIGINS env var to restrict origins
# e.g., ALLOWED_ORIGINS=https://myapp.com,https://admin.myapp.com
allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
allowed_origins = [o.strip() for o in allowed_origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    # Use explicit origins list if configured, otherwise allow localhost for dev
    allow_origins=allowed_origins if allowed_origins else ["http://localhost:3000", "http://localhost:8080"],
    # Disable credentials when using wildcard origins (security best practice)
    allow_credentials=bool(allowed_origins),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


class ToolRequest(BaseModel):
    """Request body for tool invocation."""
    arguments: dict = {}


class ToolResponse(BaseModel):
    """Response from tool invocation."""
    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None


# Map tool names to their functions
TOOLS = {
    # Repositories
    "get_repository": mcp_server.get_repository,
    "create_repository": mcp_server.create_repository,
    "delete_repository": mcp_server.delete_repository,
    "list_repositories": mcp_server.list_repositories,
    # Pull Requests
    "create_pull_request": mcp_server.create_pull_request,
    "get_pull_request": mcp_server.get_pull_request,
    "list_pull_requests": mcp_server.list_pull_requests,
    "merge_pull_request": mcp_server.merge_pull_request,
    # Pipelines
    "trigger_pipeline": mcp_server.trigger_pipeline,
    "get_pipeline": mcp_server.get_pipeline,
    "list_pipelines": mcp_server.list_pipelines,
    "get_pipeline_logs": mcp_server.get_pipeline_logs,
    "stop_pipeline": mcp_server.stop_pipeline,
    # Branches
    "list_branches": mcp_server.list_branches,
    "get_branch": mcp_server.get_branch,
}


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        # Verify credentials are configured
        client = get_client()
        return {
            "status": "healthy",
            "workspace": client.workspace,
            "version": "0.1.0",
        }
    except BitbucketError as e:
        return {
            "status": "unhealthy",
            "error": str(e),
        }


@app.get("/tools")
async def list_tools():
    """List available tools and their descriptions."""
    tools_info = []
    for name, func in TOOLS.items():
        # Extract info from docstring
        doc = func.__doc__ or ""
        description = doc.split("\n")[0] if doc else ""

        # Get function parameters
        import inspect
        sig = inspect.signature(func)
        params = {
            name: {
                "type": str(param.annotation.__name__) if param.annotation != inspect.Parameter.empty else "any",
                "default": param.default if param.default != inspect.Parameter.empty else None,
                "required": param.default == inspect.Parameter.empty,
            }
            for name, param in sig.parameters.items()
        }

        tools_info.append({
            "name": name,
            "description": description,
            "parameters": params,
        })

    return {"tools": tools_info}


@app.post("/tools/{tool_name}")
async def invoke_tool(tool_name: str, request: ToolRequest) -> ToolResponse:
    """Invoke a specific tool by name.

    Args:
        tool_name: Name of the tool to invoke
        request: Tool arguments

    Returns:
        Tool execution result
    """
    if tool_name not in TOOLS:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{tool_name}' not found. Available: {list(TOOLS.keys())}",
        )

    tool_func = TOOLS[tool_name]

    try:
        # Log tool invocation without potentially sensitive arguments
        logger.info(f"Invoking tool: {tool_name}")
        result = tool_func(**request.arguments)
        logger.info(f"Tool {tool_name} completed successfully")

        # Check if result indicates an error
        if isinstance(result, dict) and result.get("error"):
            return ToolResponse(
                success=False,
                error=result["error"],
                result=result,
            )

        return ToolResponse(
            success=True,
            result=result,
        )

    except TypeError as e:
        # Wrong arguments - log full error internally, return generic message
        logger.warning(f"Invalid arguments for {tool_name}: {e}")
        return ToolResponse(
            success=False,
            error="Invalid arguments provided. Please check the tool documentation.",
        )
    except BitbucketError as e:
        # Log full API error internally, return sanitized message
        logger.warning(f"Bitbucket API error for {tool_name}: {e}")
        return ToolResponse(
            success=False,
            error="Bitbucket API request failed. Please check your permissions and try again.",
        )
    except Exception as e:
        # Log full exception internally, never expose internal details
        logger.exception(f"Error invoking tool {tool_name}")
        return ToolResponse(
            success=False,
            error="An internal error occurred. Please try again later.",
        )


# Convenience endpoints for common operations

@app.get("/repos")
async def get_repos(project_key: Optional[str] = None, limit: int = 50):
    """List repositories (convenience endpoint)."""
    return mcp_server.list_repositories(project_key=project_key, limit=limit)


@app.get("/repos/{repo_slug}")
async def get_repo(repo_slug: str):
    """Get repository info (convenience endpoint)."""
    return mcp_server.get_repository(repo_slug=repo_slug)


@app.get("/repos/{repo_slug}/prs")
async def get_prs(repo_slug: str, state: str = "OPEN", limit: int = 20):
    """List pull requests (convenience endpoint)."""
    return mcp_server.list_pull_requests(repo_slug=repo_slug, state=state, limit=limit)


@app.get("/repos/{repo_slug}/pipelines")
async def get_pipelines(repo_slug: str, limit: int = 10):
    """List pipelines (convenience endpoint)."""
    return mcp_server.list_pipelines(repo_slug=repo_slug, limit=limit)


@app.get("/repos/{repo_slug}/branches")
async def get_branches(repo_slug: str, limit: int = 50):
    """List branches (convenience endpoint)."""
    return mcp_server.list_branches(repo_slug=repo_slug, limit=limit)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
