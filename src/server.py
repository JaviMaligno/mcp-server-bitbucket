"""Bitbucket MCP Server using FastMCP.

Provides tools for interacting with Bitbucket repositories,
pull requests, pipelines, and branches.

Usage:
    # Run as stdio server (for Claude Desktop/Code)
    python -m src.server

    # Or via poetry script
    bitbucket-mcp
"""
from typing import Optional

from mcp.server.fastmcp import FastMCP

from src.bitbucket_client import get_client, BitbucketError

# Initialize FastMCP server
mcp = FastMCP("bitbucket")


# ==================== REPOSITORY TOOLS ====================


@mcp.tool()
def get_repository(repo_slug: str) -> dict:
    """Get information about a Bitbucket repository.

    Args:
        repo_slug: Repository slug (e.g., "anzsic_classifier")

    Returns:
        Repository info including name, description, clone URLs, and metadata
    """
    client = get_client()
    result = client.get_repository(repo_slug)
    if not result:
        return {"error": f"Repository '{repo_slug}' not found"}

    return {
        "name": result.get("name"),
        "full_name": result.get("full_name"),
        "description": result.get("description", ""),
        "is_private": result.get("is_private"),
        "created_on": result.get("created_on"),
        "updated_on": result.get("updated_on"),
        "mainbranch": result.get("mainbranch", {}).get("name"),
        "clone_urls": client.extract_clone_urls(result),
        "project": result.get("project", {}).get("key"),
    }


@mcp.tool()
def create_repository(
    repo_slug: str,
    project_key: Optional[str] = None,
    is_private: bool = True,
    description: str = "",
) -> dict:
    """Create a new Bitbucket repository.

    Args:
        repo_slug: Repository slug (lowercase, no spaces)
        project_key: Project key to create repo under (optional)
        is_private: Whether repository is private (default: True)
        description: Repository description

    Returns:
        Created repository info with clone URLs
    """
    client = get_client()
    try:
        result = client.create_repository(
            repo_slug=repo_slug,
            project_key=project_key,
            is_private=is_private,
            description=description,
        )
        return {
            "success": True,
            "name": result.get("name"),
            "full_name": result.get("full_name"),
            "clone_urls": client.extract_clone_urls(result),
            "html_url": result.get("links", {}).get("html", {}).get("href"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_repository(repo_slug: str) -> dict:
    """Delete a Bitbucket repository.

    WARNING: This action is irreversible!

    Args:
        repo_slug: Repository slug to delete

    Returns:
        Success status
    """
    client = get_client()
    try:
        client.delete_repository(repo_slug)
        return {"success": True, "message": f"Repository '{repo_slug}' deleted"}
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def list_repositories(project_key: Optional[str] = None, limit: int = 50) -> dict:
    """List repositories in the workspace.

    Args:
        project_key: Filter by project (optional)
        limit: Maximum number of results (default: 50)

    Returns:
        List of repositories with basic info
    """
    client = get_client()
    repos = client.list_repositories(project_key=project_key, limit=limit)
    return {
        "count": len(repos),
        "repositories": [
            {
                "name": r.get("name"),
                "full_name": r.get("full_name"),
                "is_private": r.get("is_private"),
                "project": r.get("project", {}).get("key"),
            }
            for r in repos
        ],
    }


# ==================== PULL REQUEST TOOLS ====================


@mcp.tool()
def create_pull_request(
    repo_slug: str,
    title: str,
    source_branch: str,
    destination_branch: str = "main",
    description: str = "",
    close_source_branch: bool = True,
) -> dict:
    """Create a pull request in a Bitbucket repository.

    Args:
        repo_slug: Repository slug (e.g., "anzsic_classifier")
        title: PR title
        source_branch: Source branch name
        destination_branch: Target branch (default: main)
        description: PR description in markdown
        close_source_branch: Delete source branch after merge (default: True)

    Returns:
        Created PR info with id, url, and state
    """
    client = get_client()
    try:
        result = client.create_pull_request(
            repo_slug=repo_slug,
            title=title,
            source_branch=source_branch,
            destination_branch=destination_branch,
            description=description,
            close_source_branch=close_source_branch,
        )
        return {
            "success": True,
            "id": result.get("id"),
            "title": result.get("title"),
            "state": result.get("state"),
            "url": client.extract_pr_url(result),
            "source_branch": source_branch,
            "destination_branch": destination_branch,
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_pull_request(repo_slug: str, pr_id: int) -> dict:
    """Get information about a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        PR info including state, author, reviewers, and merge status
    """
    client = get_client()
    result = client.get_pull_request(repo_slug, pr_id)
    if not result:
        return {"error": f"PR #{pr_id} not found in {repo_slug}"}

    return {
        "id": result.get("id"),
        "title": result.get("title"),
        "description": result.get("description", ""),
        "state": result.get("state"),
        "author": result.get("author", {}).get("display_name"),
        "source_branch": result.get("source", {}).get("branch", {}).get("name"),
        "destination_branch": result.get("destination", {}).get("branch", {}).get("name"),
        "created_on": result.get("created_on"),
        "updated_on": result.get("updated_on"),
        "url": client.extract_pr_url(result),
        "comment_count": result.get("comment_count", 0),
        "task_count": result.get("task_count", 0),
    }


@mcp.tool()
def list_pull_requests(
    repo_slug: str,
    state: str = "OPEN",
    limit: int = 20,
) -> dict:
    """List pull requests in a repository.

    Args:
        repo_slug: Repository slug
        state: Filter by state: OPEN, MERGED, DECLINED, SUPERSEDED (default: OPEN)
        limit: Maximum number of results (default: 20)

    Returns:
        List of PRs with basic info
    """
    client = get_client()
    prs = client.list_pull_requests(repo_slug, state=state, limit=limit)
    return {
        "count": len(prs),
        "state_filter": state,
        "pull_requests": [
            {
                "id": pr.get("id"),
                "title": pr.get("title"),
                "state": pr.get("state"),
                "author": pr.get("author", {}).get("display_name"),
                "source_branch": pr.get("source", {}).get("branch", {}).get("name"),
                "destination_branch": pr.get("destination", {}).get("branch", {}).get("name"),
                "url": client.extract_pr_url(pr),
            }
            for pr in prs
        ],
    }


@mcp.tool()
def merge_pull_request(
    repo_slug: str,
    pr_id: int,
    merge_strategy: str = "merge_commit",
    close_source_branch: bool = True,
    message: Optional[str] = None,
) -> dict:
    """Merge a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID
        merge_strategy: One of 'merge_commit', 'squash', 'fast_forward' (default: merge_commit)
        close_source_branch: Delete source branch after merge (default: True)
        message: Optional merge commit message

    Returns:
        Merged PR info
    """
    client = get_client()
    try:
        result = client.merge_pull_request(
            repo_slug=repo_slug,
            pr_id=pr_id,
            merge_strategy=merge_strategy,
            close_source_branch=close_source_branch,
            message=message,
        )
        return {
            "success": True,
            "id": result.get("id"),
            "state": result.get("state"),
            "merge_commit": result.get("merge_commit", {}).get("hash"),
            "url": client.extract_pr_url(result),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== PIPELINE TOOLS ====================


@mcp.tool()
def trigger_pipeline(
    repo_slug: str,
    branch: str = "main",
    variables: Optional[dict] = None,
) -> dict:
    """Trigger a pipeline run on a repository.

    Args:
        repo_slug: Repository slug
        branch: Branch to run pipeline on (default: main)
        variables: Custom pipeline variables as key-value pairs (optional)

    Returns:
        Pipeline run info with uuid and state
    """
    client = get_client()
    try:
        result = client.trigger_pipeline(
            repo_slug=repo_slug,
            branch=branch,
            variables=variables,
        )
        return {
            "success": True,
            "uuid": result.get("uuid"),
            "build_number": result.get("build_number"),
            "state": result.get("state", {}).get("name"),
            "branch": branch,
            "created_on": result.get("created_on"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_pipeline(repo_slug: str, pipeline_uuid: str) -> dict:
    """Get status of a pipeline run.

    Args:
        repo_slug: Repository slug
        pipeline_uuid: Pipeline UUID (from trigger_pipeline)

    Returns:
        Pipeline status including state, duration, and steps
    """
    client = get_client()
    result = client.get_pipeline(repo_slug, pipeline_uuid)
    if not result:
        return {"error": f"Pipeline '{pipeline_uuid}' not found"}

    state = result.get("state", {})
    return {
        "uuid": result.get("uuid"),
        "build_number": result.get("build_number"),
        "state": state.get("name"),
        "result": state.get("result", {}).get("name") if state.get("result") else None,
        "branch": result.get("target", {}).get("ref_name"),
        "created_on": result.get("created_on"),
        "completed_on": result.get("completed_on"),
        "duration_in_seconds": result.get("duration_in_seconds"),
    }


@mcp.tool()
def list_pipelines(repo_slug: str, limit: int = 10) -> dict:
    """List recent pipeline runs for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 10)

    Returns:
        List of recent pipeline runs
    """
    client = get_client()
    pipelines = client.list_pipelines(repo_slug, limit=limit)
    return {
        "count": len(pipelines),
        "pipelines": [
            {
                "uuid": p.get("uuid"),
                "build_number": p.get("build_number"),
                "state": p.get("state", {}).get("name"),
                "result": p.get("state", {}).get("result", {}).get("name")
                if p.get("state", {}).get("result")
                else None,
                "branch": p.get("target", {}).get("ref_name"),
                "created_on": p.get("created_on"),
            }
            for p in pipelines
        ],
    }


@mcp.tool()
def get_pipeline_logs(
    repo_slug: str,
    pipeline_uuid: str,
    step_uuid: Optional[str] = None,
) -> dict:
    """Get logs for a pipeline run.

    If step_uuid is not provided, returns list of steps to choose from.

    Args:
        repo_slug: Repository slug
        pipeline_uuid: Pipeline UUID
        step_uuid: Step UUID (optional, get from steps list first)

    Returns:
        Pipeline logs or list of available steps
    """
    client = get_client()

    if not step_uuid:
        # Return list of steps
        steps = client.get_pipeline_steps(repo_slug, pipeline_uuid)
        return {
            "message": "Provide step_uuid to get logs for a specific step",
            "steps": [
                {
                    "uuid": s.get("uuid"),
                    "name": s.get("name"),
                    "state": s.get("state", {}).get("name"),
                    "result": s.get("state", {}).get("result", {}).get("name")
                    if s.get("state", {}).get("result")
                    else None,
                }
                for s in steps
            ],
        }

    # Get logs for specific step
    logs = client.get_pipeline_logs(repo_slug, pipeline_uuid, step_uuid)
    return {
        "step_uuid": step_uuid,
        "logs": logs if logs else "(no logs available)",
    }


@mcp.tool()
def stop_pipeline(repo_slug: str, pipeline_uuid: str) -> dict:
    """Stop a running pipeline.

    Args:
        repo_slug: Repository slug
        pipeline_uuid: Pipeline UUID

    Returns:
        Updated pipeline status
    """
    client = get_client()
    try:
        result = client.stop_pipeline(repo_slug, pipeline_uuid)
        return {
            "success": True,
            "uuid": result.get("uuid"),
            "state": result.get("state", {}).get("name"),
            "message": "Pipeline stop requested",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== BRANCH TOOLS ====================


@mcp.tool()
def list_branches(repo_slug: str, limit: int = 50) -> dict:
    """List branches in a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of branches with commit info
    """
    client = get_client()
    branches = client.list_branches(repo_slug, limit=limit)
    return {
        "count": len(branches),
        "branches": [
            {
                "name": b.get("name"),
                "target": {
                    "hash": b.get("target", {}).get("hash", "")[:12],
                    "message": b.get("target", {}).get("message", "").split("\n")[0],
                    "date": b.get("target", {}).get("date"),
                },
            }
            for b in branches
        ],
    }


@mcp.tool()
def get_branch(repo_slug: str, branch_name: str) -> dict:
    """Get information about a specific branch.

    Args:
        repo_slug: Repository slug
        branch_name: Branch name

    Returns:
        Branch info with latest commit details
    """
    client = get_client()
    result = client.get_branch(repo_slug, branch_name)
    if not result:
        return {"error": f"Branch '{branch_name}' not found in {repo_slug}"}

    target = result.get("target", {})
    return {
        "name": result.get("name"),
        "latest_commit": {
            "hash": target.get("hash"),
            "message": target.get("message", ""),
            "author": target.get("author", {}).get("raw"),
            "date": target.get("date"),
        },
    }


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
