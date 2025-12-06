"""Bitbucket MCP Server using FastMCP.

Provides tools for interacting with Bitbucket repositories,
pull requests, pipelines, branches, commits, deployments, and webhooks.

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
def list_repositories(
    project_key: Optional[str] = None,
    search: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 50,
) -> dict:
    """List and search repositories in the workspace.

    Args:
        project_key: Filter by project key (optional)
        search: Simple search term for repository name (optional)
                Uses fuzzy matching: search="anzsic" finds "anzsic_classifier"
        query: Advanced Bitbucket query syntax (optional)
               Examples:
               - name ~ "api" (partial name match)
               - description ~ "classifier" (search description)
               - is_private = false (public repos only)
               - name ~ "test" AND is_private = true
        limit: Maximum number of results (default: 50)

    Returns:
        List of repositories with basic info
    """
    client = get_client()

    # Convert simple search to query syntax
    effective_query = query
    if search and not query:
        effective_query = f'name ~ "{search}"'

    repos = client.list_repositories(
        project_key=project_key,
        query=effective_query,
        limit=limit,
    )
    return {
        "count": len(repos),
        "search": search,
        "query": effective_query,
        "repositories": [
            {
                "name": r.get("name"),
                "full_name": r.get("full_name"),
                "description": r.get("description", "")[:100] if r.get("description") else "",
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


# ==================== PROJECT TOOLS ====================


@mcp.tool()
def list_projects(limit: int = 50) -> dict:
    """List projects in the workspace.

    Args:
        limit: Maximum number of results (default: 50)

    Returns:
        List of projects with key, name, and description
    """
    client = get_client()
    projects = client.list_projects(limit=limit)
    return {
        "count": len(projects),
        "projects": [
            {
                "key": p.get("key"),
                "name": p.get("name"),
                "description": p.get("description", "")[:100] if p.get("description") else "",
                "is_private": p.get("is_private"),
                "created_on": p.get("created_on"),
            }
            for p in projects
        ],
    }


@mcp.tool()
def get_project(project_key: str) -> dict:
    """Get information about a specific project.

    Args:
        project_key: Project key (e.g., "DS", "PROJ")

    Returns:
        Project info including name, description, and metadata
    """
    client = get_client()
    result = client.get_project(project_key)
    if not result:
        return {"error": f"Project '{project_key}' not found"}

    return {
        "key": result.get("key"),
        "name": result.get("name"),
        "description": result.get("description", ""),
        "is_private": result.get("is_private"),
        "created_on": result.get("created_on"),
        "updated_on": result.get("updated_on"),
    }


# ==================== REPOSITORY UPDATE TOOLS ====================


@mcp.tool()
def update_repository(
    repo_slug: str,
    project_key: Optional[str] = None,
    is_private: Optional[bool] = None,
    description: Optional[str] = None,
    name: Optional[str] = None,
) -> dict:
    """Update repository settings (project, visibility, description, name).

    Use this to move a repository to a different project, change visibility,
    update description, or rename the repository.

    Args:
        repo_slug: Repository slug (e.g., "anzsic_classifier")
        project_key: Move to different project (optional, e.g., "DS")
        is_private: Change visibility (optional)
        description: Update description (optional)
        name: Rename repository (optional)

    Returns:
        Updated repository info
    """
    client = get_client()
    try:
        result = client.update_repository(
            repo_slug=repo_slug,
            project_key=project_key,
            is_private=is_private,
            description=description,
            name=name,
        )
        return {
            "success": True,
            "name": result.get("name"),
            "full_name": result.get("full_name"),
            "project": result.get("project", {}).get("key"),
            "is_private": result.get("is_private"),
            "description": result.get("description", ""),
            "html_url": result.get("links", {}).get("html", {}).get("href"),
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


# ==================== COMMIT TOOLS ====================


@mcp.tool()
def list_commits(
    repo_slug: str,
    branch: Optional[str] = None,
    path: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """List commits in a repository.

    Args:
        repo_slug: Repository slug
        branch: Filter by branch name (optional)
        path: Filter by file path - only commits that modified this path (optional)
        limit: Maximum number of results (default: 20)

    Returns:
        List of commits with hash, message, author, and date
    """
    client = get_client()
    commits = client.list_commits(repo_slug, branch=branch, path=path, limit=limit)
    return {
        "count": len(commits),
        "branch": branch,
        "path": path,
        "commits": [
            {
                "hash": c.get("hash", "")[:12],
                "full_hash": c.get("hash"),
                "message": c.get("message", "").split("\n")[0],
                "author": c.get("author", {}).get("raw", ""),
                "date": c.get("date"),
            }
            for c in commits
        ],
    }


@mcp.tool()
def get_commit(repo_slug: str, commit: str) -> dict:
    """Get detailed information about a specific commit.

    Args:
        repo_slug: Repository slug
        commit: Commit hash (full or short)

    Returns:
        Commit details including message, author, date, and parents
    """
    client = get_client()
    result = client.get_commit(repo_slug, commit)
    if not result:
        return {"error": f"Commit '{commit}' not found in {repo_slug}"}

    return {
        "hash": result.get("hash"),
        "message": result.get("message", ""),
        "author": {
            "raw": result.get("author", {}).get("raw"),
            "user": result.get("author", {}).get("user", {}).get("display_name"),
        },
        "date": result.get("date"),
        "parents": [p.get("hash", "")[:12] for p in result.get("parents", [])],
    }


@mcp.tool()
def compare_commits(repo_slug: str, base: str, head: str) -> dict:
    """Compare two commits or branches and see files changed.

    Args:
        repo_slug: Repository slug
        base: Base commit hash or branch name
        head: Head commit hash or branch name

    Returns:
        Diff statistics showing files added, modified, and removed
    """
    client = get_client()
    result = client.compare_commits(repo_slug, base, head)
    if not result:
        return {"error": f"Could not compare {base}..{head}"}

    files = result.get("values", [])
    return {
        "base": base,
        "head": head,
        "files_changed": len(files),
        "files": [
            {
                "path": f.get("new", {}).get("path") or f.get("old", {}).get("path"),
                "status": f.get("status"),
                "lines_added": f.get("lines_added", 0),
                "lines_removed": f.get("lines_removed", 0),
            }
            for f in files[:50]  # Limit to first 50 files
        ],
    }


# ==================== COMMIT STATUS TOOLS ====================


@mcp.tool()
def get_commit_statuses(
    repo_slug: str,
    commit: str,
    limit: int = 20,
) -> dict:
    """Get build/CI statuses for a commit.

    Args:
        repo_slug: Repository slug
        commit: Commit hash
        limit: Maximum number of results (default: 20)

    Returns:
        List of CI/CD statuses (builds, checks) for the commit
    """
    client = get_client()
    statuses = client.get_commit_statuses(repo_slug, commit, limit=limit)
    return {
        "commit": commit[:12],
        "count": len(statuses),
        "statuses": [
            {
                "key": s.get("key"),
                "name": s.get("name"),
                "state": s.get("state"),
                "description": s.get("description", ""),
                "url": s.get("url"),
                "created_on": s.get("created_on"),
                "updated_on": s.get("updated_on"),
            }
            for s in statuses
        ],
    }


@mcp.tool()
def create_commit_status(
    repo_slug: str,
    commit: str,
    state: str,
    key: str,
    url: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> dict:
    """Create a build status for a commit.

    Use this to report CI/CD status from external systems.

    Args:
        repo_slug: Repository slug
        commit: Commit hash
        state: Status state - one of: SUCCESSFUL, FAILED, INPROGRESS, STOPPED
        key: Unique identifier for this status (e.g., "my-ci-system")
        url: URL to the build details (optional)
        name: Display name for the status (optional)
        description: Status description (optional)

    Returns:
        Created status info
    """
    client = get_client()
    try:
        result = client.create_commit_status(
            repo_slug=repo_slug,
            commit=commit,
            state=state,
            key=key,
            url=url,
            name=name,
            description=description,
        )
        return {
            "success": True,
            "key": result.get("key"),
            "state": result.get("state"),
            "name": result.get("name"),
            "url": result.get("url"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== PR COMMENT & REVIEW TOOLS ====================


@mcp.tool()
def list_pr_comments(
    repo_slug: str,
    pr_id: int,
    limit: int = 50,
) -> dict:
    """List comments on a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID
        limit: Maximum number of results (default: 50)

    Returns:
        List of comments with author, content, and timestamps
    """
    client = get_client()
    comments = client.list_pr_comments(repo_slug, pr_id, limit=limit)
    return {
        "pr_id": pr_id,
        "count": len(comments),
        "comments": [
            {
                "id": c.get("id"),
                "author": c.get("user", {}).get("display_name"),
                "content": c.get("content", {}).get("raw", ""),
                "created_on": c.get("created_on"),
                "updated_on": c.get("updated_on"),
                "inline": c.get("inline"),  # None for general comments
            }
            for c in comments
        ],
    }


@mcp.tool()
def add_pr_comment(
    repo_slug: str,
    pr_id: int,
    content: str,
    file_path: Optional[str] = None,
    line: Optional[int] = None,
) -> dict:
    """Add a comment to a pull request.

    Can add general comments or inline comments on specific lines.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID
        content: Comment content (markdown supported)
        file_path: File path for inline comment (optional)
        line: Line number for inline comment (optional, requires file_path)

    Returns:
        Created comment info
    """
    client = get_client()
    try:
        inline = None
        if file_path and line:
            inline = {"path": file_path, "to": line}

        result = client.add_pr_comment(
            repo_slug=repo_slug,
            pr_id=pr_id,
            content=content,
            inline=inline,
        )
        return {
            "success": True,
            "id": result.get("id"),
            "content": result.get("content", {}).get("raw", ""),
            "inline": inline,
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def approve_pr(repo_slug: str, pr_id: int) -> dict:
    """Approve a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Approval confirmation
    """
    client = get_client()
    try:
        result = client.approve_pr(repo_slug, pr_id)
        return {
            "success": True,
            "pr_id": pr_id,
            "approved_by": result.get("user", {}).get("display_name"),
            "approved_on": result.get("date"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def unapprove_pr(repo_slug: str, pr_id: int) -> dict:
    """Remove your approval from a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Confirmation of approval removal
    """
    client = get_client()
    try:
        client.unapprove_pr(repo_slug, pr_id)
        return {
            "success": True,
            "pr_id": pr_id,
            "message": "Approval removed",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def request_changes_pr(repo_slug: str, pr_id: int) -> dict:
    """Request changes on a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Confirmation of change request
    """
    client = get_client()
    try:
        result = client.request_changes_pr(repo_slug, pr_id)
        return {
            "success": True,
            "pr_id": pr_id,
            "requested_by": result.get("user", {}).get("display_name"),
            "requested_on": result.get("date"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def decline_pr(repo_slug: str, pr_id: int) -> dict:
    """Decline (close without merging) a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Declined PR info
    """
    client = get_client()
    try:
        result = client.decline_pr(repo_slug, pr_id)
        return {
            "success": True,
            "pr_id": pr_id,
            "state": result.get("state"),
            "message": "Pull request declined",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_pr_diff(repo_slug: str, pr_id: int) -> dict:
    """Get the diff of a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Diff content as text
    """
    client = get_client()
    try:
        diff = client.get_pr_diff(repo_slug, pr_id)
        if not diff:
            return {"error": f"PR #{pr_id} not found or has no diff"}

        # Truncate if too long
        max_length = 50000
        truncated = len(diff) > max_length
        return {
            "pr_id": pr_id,
            "diff": diff[:max_length] if truncated else diff,
            "truncated": truncated,
            "total_length": len(diff),
        }
    except BitbucketError as e:
        return {"error": str(e)}


# ==================== DEPLOYMENT TOOLS ====================


@mcp.tool()
def list_environments(repo_slug: str, limit: int = 20) -> dict:
    """List deployment environments for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 20)

    Returns:
        List of environments (e.g., test, staging, production)
    """
    client = get_client()
    environments = client.list_environments(repo_slug, limit=limit)
    return {
        "count": len(environments),
        "environments": [
            {
                "uuid": e.get("uuid"),
                "name": e.get("name"),
                "environment_type": e.get("environment_type", {}).get("name"),
                "rank": e.get("rank"),
            }
            for e in environments
        ],
    }


@mcp.tool()
def get_environment(repo_slug: str, environment_uuid: str) -> dict:
    """Get details about a specific deployment environment.

    Args:
        repo_slug: Repository slug
        environment_uuid: Environment UUID (from list_environments)

    Returns:
        Environment details including restrictions and variables
    """
    client = get_client()
    result = client.get_environment(repo_slug, environment_uuid)
    if not result:
        return {"error": f"Environment '{environment_uuid}' not found"}

    return {
        "uuid": result.get("uuid"),
        "name": result.get("name"),
        "environment_type": result.get("environment_type", {}).get("name"),
        "rank": result.get("rank"),
        "restrictions": result.get("restrictions"),
        "lock": result.get("lock"),
    }


@mcp.tool()
def list_deployment_history(
    repo_slug: str,
    environment_uuid: str,
    limit: int = 20,
) -> dict:
    """Get deployment history for a specific environment.

    Args:
        repo_slug: Repository slug
        environment_uuid: Environment UUID (from list_environments)
        limit: Maximum number of results (default: 20)

    Returns:
        List of deployments with status, commit, and timestamps
    """
    client = get_client()
    deployments = client.list_deployment_history(
        repo_slug, environment_uuid, limit=limit
    )
    return {
        "environment_uuid": environment_uuid,
        "count": len(deployments),
        "deployments": [
            {
                "uuid": d.get("uuid"),
                "state": d.get("state", {}).get("name"),
                "commit": d.get("commit", {}).get("hash", "")[:12],
                "pipeline_uuid": d.get("release", {}).get("pipeline", {}).get("uuid"),
                "started_on": d.get("state", {}).get("started_on"),
                "completed_on": d.get("state", {}).get("completed_on"),
            }
            for d in deployments
        ],
    }


# ==================== WEBHOOK TOOLS ====================


@mcp.tool()
def list_webhooks(repo_slug: str, limit: int = 50) -> dict:
    """List webhooks configured for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of webhooks with URL, events, and status
    """
    client = get_client()
    webhooks = client.list_webhooks(repo_slug, limit=limit)
    return {
        "count": len(webhooks),
        "webhooks": [
            {
                "uuid": w.get("uuid"),
                "url": w.get("url"),
                "description": w.get("description", ""),
                "events": w.get("events", []),
                "active": w.get("active"),
                "created_at": w.get("created_at"),
            }
            for w in webhooks
        ],
    }


@mcp.tool()
def create_webhook(
    repo_slug: str,
    url: str,
    events: list,
    description: str = "",
    active: bool = True,
) -> dict:
    """Create a webhook for a repository.

    Args:
        repo_slug: Repository slug
        url: URL to call when events occur
        events: List of events to trigger on. Common events:
                - repo:push (code pushed)
                - pullrequest:created, pullrequest:updated, pullrequest:merged
                - pullrequest:approved, pullrequest:unapproved
                - pullrequest:comment_created
        description: Webhook description (optional)
        active: Whether webhook is active (default: True)

    Returns:
        Created webhook info with UUID
    """
    client = get_client()
    try:
        result = client.create_webhook(
            repo_slug=repo_slug,
            url=url,
            events=events,
            description=description,
            active=active,
        )
        return {
            "success": True,
            "uuid": result.get("uuid"),
            "url": result.get("url"),
            "events": result.get("events"),
            "active": result.get("active"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_webhook(repo_slug: str, webhook_uuid: str) -> dict:
    """Get details about a specific webhook.

    Args:
        repo_slug: Repository slug
        webhook_uuid: Webhook UUID (from list_webhooks)

    Returns:
        Webhook details including URL, events, and status
    """
    client = get_client()
    result = client.get_webhook(repo_slug, webhook_uuid)
    if not result:
        return {"error": f"Webhook '{webhook_uuid}' not found"}

    return {
        "uuid": result.get("uuid"),
        "url": result.get("url"),
        "description": result.get("description", ""),
        "events": result.get("events", []),
        "active": result.get("active"),
        "created_at": result.get("created_at"),
    }


@mcp.tool()
def delete_webhook(repo_slug: str, webhook_uuid: str) -> dict:
    """Delete a webhook.

    Args:
        repo_slug: Repository slug
        webhook_uuid: Webhook UUID (from list_webhooks)

    Returns:
        Confirmation of deletion
    """
    client = get_client()
    try:
        client.delete_webhook(repo_slug, webhook_uuid)
        return {
            "success": True,
            "message": f"Webhook '{webhook_uuid}' deleted",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== TAGS ====================


@mcp.tool()
def list_tags(repo_slug: str, limit: int = 50) -> dict:
    """List tags in a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of tags with name, target commit, and tagger info
    """
    client = get_client()
    tags = client.list_tags(repo_slug, limit=limit)
    return {
        "count": len(tags),
        "tags": [
            {
                "name": t.get("name"),
                "target": (t.get("target") or {}).get("hash", "")[:12],
                "message": t.get("message", ""),
                "tagger": (t.get("tagger") or {}).get("raw", ""),
                "date": t.get("date"),
            }
            for t in tags
        ],
    }


@mcp.tool()
def create_tag(
    repo_slug: str,
    name: str,
    target: str,
    message: str = "",
) -> dict:
    """Create a new tag in a repository.

    Args:
        repo_slug: Repository slug
        name: Tag name (e.g., "v1.0.0")
        target: Commit hash or branch name to tag
        message: Optional tag message (for annotated tags)

    Returns:
        Created tag info
    """
    client = get_client()
    try:
        result = client.create_tag(
            repo_slug,
            name=name,
            target=target,
            message=message if message else None,
        )
        return {
            "success": True,
            "name": result.get("name"),
            "target": result.get("target", {}).get("hash", "")[:12],
            "message": result.get("message", ""),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_tag(repo_slug: str, tag_name: str) -> dict:
    """Delete a tag from a repository.

    Args:
        repo_slug: Repository slug
        tag_name: Tag name to delete

    Returns:
        Confirmation of deletion
    """
    client = get_client()
    try:
        client.delete_tag(repo_slug, tag_name)
        return {
            "success": True,
            "message": f"Tag '{tag_name}' deleted",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== BRANCH RESTRICTIONS ====================


@mcp.tool()
def list_branch_restrictions(repo_slug: str, limit: int = 50) -> dict:
    """List branch restrictions (protection rules) in a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of branch restrictions with kind, pattern, and settings
    """
    client = get_client()
    restrictions = client.list_branch_restrictions(repo_slug, limit=limit)
    return {
        "count": len(restrictions),
        "restrictions": [
            {
                "id": r.get("id"),
                "kind": r.get("kind"),
                "pattern": r.get("pattern", ""),
                "branch_match_kind": r.get("branch_match_kind"),
                "branch_type": r.get("branch_type"),
                "value": r.get("value"),
                "users": [u.get("display_name") for u in r.get("users", [])],
                "groups": [g.get("name") for g in r.get("groups", [])],
            }
            for r in restrictions
        ],
    }


@mcp.tool()
def create_branch_restriction(
    repo_slug: str,
    kind: str,
    pattern: str = "",
    branch_match_kind: str = "glob",
    branch_type: str = "",
    value: int = 0,
) -> dict:
    """Create a branch restriction (protection rule).

    Args:
        repo_slug: Repository slug
        kind: Type of restriction. Common values:
              - "push" - Restrict who can push
              - "force" - Restrict force push
              - "delete" - Restrict branch deletion
              - "restrict_merges" - Restrict who can merge
              - "require_passing_builds_to_merge" - Require CI to pass
              - "require_approvals_to_merge" - Require PR approvals
              - "require_default_reviewer_approvals_to_merge"
              - "require_no_changes_requested"
              - "require_tasks_to_be_completed"
        pattern: Branch pattern (e.g., "main", "release/*"). Required for glob match.
        branch_match_kind: How to match branches - "glob" (pattern) or "branching_model" (development/production)
        branch_type: Branch type when using branching_model - "development", "production", or specific category
        value: Numeric value for restrictions that need it (e.g., number of required approvals)

    Returns:
        Created restriction info with ID
    """
    client = get_client()
    try:
        result = client.create_branch_restriction(
            repo_slug,
            kind=kind,
            pattern=pattern,
            branch_match_kind=branch_match_kind,
            branch_type=branch_type if branch_type else None,
            value=value if value else None,
        )
        return {
            "success": True,
            "id": result.get("id"),
            "kind": result.get("kind"),
            "pattern": result.get("pattern", ""),
            "branch_match_kind": result.get("branch_match_kind"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_branch_restriction(repo_slug: str, restriction_id: int) -> dict:
    """Delete a branch restriction.

    Args:
        repo_slug: Repository slug
        restriction_id: Restriction ID (from list_branch_restrictions)

    Returns:
        Confirmation of deletion
    """
    client = get_client()
    try:
        client.delete_branch_restriction(repo_slug, restriction_id)
        return {
            "success": True,
            "message": f"Branch restriction {restriction_id} deleted",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== SOURCE (FILE BROWSING) ====================


@mcp.tool()
def get_file_content(
    repo_slug: str,
    path: str,
    ref: str = "main",
) -> dict:
    """Get the content of a file from a repository.

    Read file contents without cloning the repository.

    Args:
        repo_slug: Repository slug
        path: File path (e.g., "src/main.py", "README.md")
        ref: Branch, tag, or commit hash (default: "main")

    Returns:
        File content as text (or error if binary/not found)
    """
    client = get_client()
    content = client.get_file_content(repo_slug, path, ref=ref)
    if content is None:
        return {"error": f"File '{path}' not found at ref '{ref}'"}

    return {
        "path": path,
        "ref": ref,
        "content": content,
        "size": len(content),
    }


@mcp.tool()
def list_directory(
    repo_slug: str,
    path: str = "",
    ref: str = "main",
    limit: int = 100,
) -> dict:
    """List contents of a directory in a repository.

    Browse repository structure without cloning.

    Args:
        repo_slug: Repository slug
        path: Directory path (empty string for root)
        ref: Branch, tag, or commit hash (default: "main")
        limit: Maximum number of entries (default: 100)

    Returns:
        List of files and directories with their types and sizes
    """
    client = get_client()
    entries = client.list_directory(repo_slug, path, ref=ref, limit=limit)

    return {
        "path": path or "/",
        "ref": ref,
        "count": len(entries),
        "entries": [
            {
                "path": e.get("path"),
                "type": e.get("type"),  # "commit_file" or "commit_directory"
                "size": e.get("size"),
            }
            for e in entries
        ],
    }


# ==================== REPOSITORY PERMISSIONS - USERS ====================


@mcp.tool()
def list_user_permissions(repo_slug: str, limit: int = 50) -> dict:
    """List user permissions for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of users with their permission levels
    """
    client = get_client()
    permissions = client.list_user_permissions(repo_slug, limit=limit)
    return {
        "count": len(permissions),
        "users": [
            {
                "user": p.get("user", {}).get("display_name"),
                "account_id": p.get("user", {}).get("account_id"),
                "permission": p.get("permission"),
            }
            for p in permissions
        ],
    }


@mcp.tool()
def get_user_permission(repo_slug: str, selected_user: str) -> dict:
    """Get a specific user's permission for a repository.

    Args:
        repo_slug: Repository slug
        selected_user: User's account_id or UUID

    Returns:
        User's permission level
    """
    client = get_client()
    result = client.get_user_permission(repo_slug, selected_user)
    if not result:
        return {"error": f"User '{selected_user}' not found or has no explicit permission"}

    return {
        "user": result.get("user", {}).get("display_name"),
        "account_id": result.get("user", {}).get("account_id"),
        "permission": result.get("permission"),
    }


@mcp.tool()
def update_user_permission(
    repo_slug: str,
    selected_user: str,
    permission: str,
) -> dict:
    """Update or add a user's permission for a repository.

    Args:
        repo_slug: Repository slug
        selected_user: User's account_id or UUID
        permission: Permission level - "read", "write", or "admin"

    Returns:
        Updated permission info
    """
    client = get_client()
    try:
        result = client.update_user_permission(repo_slug, selected_user, permission)
        return {
            "success": True,
            "user": result.get("user", {}).get("display_name"),
            "permission": result.get("permission"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_user_permission(repo_slug: str, selected_user: str) -> dict:
    """Remove a user's explicit permission from a repository.

    Args:
        repo_slug: Repository slug
        selected_user: User's account_id or UUID

    Returns:
        Confirmation of removal
    """
    client = get_client()
    try:
        client.delete_user_permission(repo_slug, selected_user)
        return {
            "success": True,
            "message": f"User '{selected_user}' permission removed",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


# ==================== REPOSITORY PERMISSIONS - GROUPS ====================


@mcp.tool()
def list_group_permissions(repo_slug: str, limit: int = 50) -> dict:
    """List group permissions for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of groups with their permission levels
    """
    client = get_client()
    permissions = client.list_group_permissions(repo_slug, limit=limit)
    return {
        "count": len(permissions),
        "groups": [
            {
                "group": p.get("group", {}).get("name"),
                "slug": p.get("group", {}).get("slug"),
                "permission": p.get("permission"),
            }
            for p in permissions
        ],
    }


@mcp.tool()
def get_group_permission(repo_slug: str, group_slug: str) -> dict:
    """Get a specific group's permission for a repository.

    Args:
        repo_slug: Repository slug
        group_slug: Group slug

    Returns:
        Group's permission level
    """
    client = get_client()
    result = client.get_group_permission(repo_slug, group_slug)
    if not result:
        return {"error": f"Group '{group_slug}' not found or has no explicit permission"}

    return {
        "group": result.get("group", {}).get("name"),
        "slug": result.get("group", {}).get("slug"),
        "permission": result.get("permission"),
    }


@mcp.tool()
def update_group_permission(
    repo_slug: str,
    group_slug: str,
    permission: str,
) -> dict:
    """Update or add a group's permission for a repository.

    Args:
        repo_slug: Repository slug
        group_slug: Group slug
        permission: Permission level - "read", "write", or "admin"

    Returns:
        Updated permission info
    """
    client = get_client()
    try:
        result = client.update_group_permission(repo_slug, group_slug, permission)
        return {
            "success": True,
            "group": result.get("group", {}).get("name"),
            "permission": result.get("permission"),
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_group_permission(repo_slug: str, group_slug: str) -> dict:
    """Remove a group's explicit permission from a repository.

    Args:
        repo_slug: Repository slug
        group_slug: Group slug

    Returns:
        Confirmation of removal
    """
    client = get_client()
    try:
        client.delete_group_permission(repo_slug, group_slug)
        return {
            "success": True,
            "message": f"Group '{group_slug}' permission removed",
        }
    except BitbucketError as e:
        return {"success": False, "error": str(e)}


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
