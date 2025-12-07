"""Bitbucket MCP Server using FastMCP.

Provides tools for interacting with Bitbucket repositories,
pull requests, pipelines, branches, commits, deployments, and webhooks.

Usage:
    # Run as stdio server (for Claude Desktop/Code)
    python -m src.server

    # Or via poetry script
    bitbucket-mcp

Output format configuration:
    Set OUTPUT_FORMAT=toon for ~30-40% token savings (TOON format)
    Default is JSON for maximum compatibility
"""
from typing import Optional

from mcp.server.fastmcp import FastMCP

from src.bitbucket_client import get_client
from src.formatter import formatted
from src.settings import CommitStatusState, MergeStrategy, PRState
from src.models import (
    BranchRestriction,
    BranchSummary,
    CommentSummary,
    CommitDetail,
    CommitStatus,
    CommitSummary,
    DeploymentSummary,
    DirectoryEntry,
    EnvironmentSummary,
    GroupPermission,
    PipelineDetail,
    PipelineStep,
    PipelineSummary,
    ProjectDetail,
    ProjectSummary,
    PullRequestDetail,
    PullRequestSummary,
    RepositoryDetail,
    RepositorySummary,
    TagSummary,
    UserPermission,
    WebhookSummary,
)
from src.utils import (
    handle_bitbucket_error,
    not_found_response,
    sanitize_search_term,
    truncate_hash,
)

# Initialize FastMCP server
mcp = FastMCP("bitbucket")


# ==================== VALIDATION HELPERS ====================


def validate_limit(limit: int, max_limit: int = 100) -> int:
    """Validate and clamp limit parameter.

    Args:
        limit: Requested limit
        max_limit: Maximum allowed limit

    Returns:
        Validated limit between 1 and max_limit
    """
    if limit < 1:
        return 1
    if limit > max_limit:
        return max_limit
    return limit


# ==================== REPOSITORY TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Repository", repo_slug)

    return RepositoryDetail.from_api(result, client.extract_clone_urls(result)).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.create_repository(
        repo_slug=repo_slug,
        project_key=project_key,
        is_private=is_private,
        description=description,
    )
    return {
        "name": result.get("name"),
        "full_name": result.get("full_name"),
        "clone_urls": client.extract_clone_urls(result),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def delete_repository(repo_slug: str) -> dict:
    """Delete a Bitbucket repository.

    WARNING: This action is irreversible!

    Args:
        repo_slug: Repository slug to delete

    Returns:
        Success status
    """
    client = get_client()
    client.delete_repository(repo_slug)
    return {}


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        limit: Maximum number of results (default: 50, max: 100)

    Returns:
        List of repositories with basic info
    """
    client = get_client()

    # Convert simple search to query syntax
    # Sanitize search term to prevent BQL injection
    effective_query = query
    if search and not query:
        safe_search = sanitize_search_term(search)
        effective_query = f'name ~ "{safe_search}"'

    validated_limit = validate_limit(limit)

    repos = client.list_repositories(
        project_key=project_key,
        query=effective_query,
        limit=validated_limit,
    )
    return {
        "repositories": [RepositorySummary.from_api(r).model_dump() for r in repos],
    }


# ==================== PULL REQUEST TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.create_pull_request(
        repo_slug=repo_slug,
        title=title,
        source_branch=source_branch,
        destination_branch=destination_branch,
        description=description,
        close_source_branch=close_source_branch,
    )
    return {
        "id": result.get("id"),
        "title": result.get("title"),
        "state": result.get("state"),
        "url": client.extract_pr_url(result),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("PR", f"#{pr_id}")

    return PullRequestDetail.from_api(result, client.extract_pr_url(result)).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_pull_requests(
    repo_slug: str,
    state: str = "OPEN",
    limit: int = 20,
) -> dict:
    """List pull requests in a repository.

    Args:
        repo_slug: Repository slug
        state: Filter by state: OPEN, MERGED, DECLINED, SUPERSEDED (default: OPEN)
        limit: Maximum number of results (default: 20, max: 100)

    Returns:
        List of PRs with basic info
    """
    # Validate state - use enum value or default to OPEN
    try:
        validated_state = PRState(state.upper()).value
    except ValueError:
        validated_state = PRState.OPEN.value

    client = get_client()
    prs = client.list_pull_requests(repo_slug, state=validated_state, limit=validate_limit(limit))
    return {
        "pull_requests": [
            PullRequestSummary.from_api(pr, client.extract_pr_url(pr)).model_dump()
            for pr in prs
        ],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    # Validate merge strategy - use enum value or default to merge_commit
    try:
        validated_strategy = MergeStrategy(merge_strategy.lower()).value
    except ValueError:
        validated_strategy = MergeStrategy.MERGE_COMMIT.value

    client = get_client()
    result = client.merge_pull_request(
        repo_slug=repo_slug,
        pr_id=pr_id,
        merge_strategy=validated_strategy,
        close_source_branch=close_source_branch,
        message=message,
    )
    return {
        "id": result.get("id"),
        "state": result.get("state"),
        "merge_commit": result.get("merge_commit", {}).get("hash"),
        "url": client.extract_pr_url(result),
    }


# ==================== PIPELINE TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.trigger_pipeline(
        repo_slug=repo_slug,
        branch=branch,
        variables=variables,
    )
    return {
        "uuid": result.get("uuid"),
        "build_number": result.get("build_number"),
        "state": result.get("state", {}).get("name"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Pipeline", pipeline_uuid)

    return PipelineDetail.from_api(result).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_pipelines(repo_slug: str, limit: int = 10) -> dict:
    """List recent pipeline runs for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 10)

    Returns:
        List of recent pipeline runs
    """
    client = get_client()
    pipelines = client.list_pipelines(repo_slug, limit=validate_limit(limit))
    return {
        "pipelines": [PipelineSummary.from_api(p).model_dump() for p in pipelines],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
            "steps": [PipelineStep.from_api(s).model_dump() for s in steps],
        }

    # Get logs for specific step
    logs = client.get_pipeline_logs(repo_slug, pipeline_uuid, step_uuid)
    return {
        "step_uuid": step_uuid,
        "logs": logs if logs else "(no logs available)",
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def stop_pipeline(repo_slug: str, pipeline_uuid: str) -> dict:
    """Stop a running pipeline.

    Args:
        repo_slug: Repository slug
        pipeline_uuid: Pipeline UUID

    Returns:
        Updated pipeline status
    """
    client = get_client()
    result = client.stop_pipeline(repo_slug, pipeline_uuid)
    return {
        "uuid": result.get("uuid"),
        "state": result.get("state", {}).get("name"),
    }


# ==================== PROJECT TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_projects(limit: int = 50) -> dict:
    """List projects in the workspace.

    Args:
        limit: Maximum number of results (default: 50)

    Returns:
        List of projects with key, name, and description
    """
    client = get_client()
    projects = client.list_projects(limit=validate_limit(limit))
    return {
        "projects": [ProjectSummary.from_api(p).model_dump() for p in projects],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Project", project_key)

    return ProjectDetail.from_api(result).model_dump()


# ==================== REPOSITORY UPDATE TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.update_repository(
        repo_slug=repo_slug,
        project_key=project_key,
        is_private=is_private,
        description=description,
        name=name,
    )
    return {
        "name": result.get("name"),
        "full_name": result.get("full_name"),
        "project": result.get("project", {}).get("key"),
        "private": result.get("is_private"),
        "description": result.get("description", ""),
    }


# ==================== BRANCH TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_branches(repo_slug: str, limit: int = 50) -> dict:
    """List branches in a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of branches with commit info
    """
    client = get_client()
    branches = client.list_branches(repo_slug, limit=validate_limit(limit))
    return {
        "branches": [BranchSummary.from_api(b).model_dump() for b in branches],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Branch", branch_name)

    target = result.get("target", {})
    return {
        "name": result.get("name"),
        "latest_commit": {
            "hash": target.get("hash"),
            "message": target.get("message", ""),
            "author": (target.get("author") or {}).get("raw"),
            "date": target.get("date"),
        },
    }


# ==================== COMMIT TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    commits = client.list_commits(repo_slug, branch=branch, path=path, limit=validate_limit(limit))
    return {
        "commits": [CommitSummary.from_api(c).model_dump() for c in commits],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Commit", commit)

    return CommitDetail.from_api(result).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        "files": [
            {
                "path": f.get("new", {}).get("path") or f.get("old", {}).get("path"),
                "status": f.get("status"),
                "+": f.get("lines_added", 0),
                "-": f.get("lines_removed", 0),
            }
            for f in files[:50]  # Limit to first 50 files
        ],
    }


# ==================== COMMIT STATUS TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    statuses = client.get_commit_statuses(repo_slug, commit, limit=validate_limit(limit))
    return {
        "commit": truncate_hash(commit),
        "statuses": [CommitStatus.from_api(s).model_dump() for s in statuses],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    # Validate state - must be a valid CommitStatusState
    try:
        validated_state = CommitStatusState(state.upper()).value
    except ValueError:
        return {"success": False, "error": f"Invalid state '{state}'. Must be one of: SUCCESSFUL, FAILED, INPROGRESS, STOPPED"}

    client = get_client()
    result = client.create_commit_status(
        repo_slug=repo_slug,
        commit=commit,
        state=validated_state,
        key=key,
        url=url,
        name=name,
        description=description,
    )
    return {
        "key": result.get("key"),
        "state": result.get("state"),
        "name": result.get("name"),
        "url": result.get("url"),
    }


# ==================== PR COMMENT & REVIEW TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    comments = client.list_pr_comments(repo_slug, pr_id, limit=validate_limit(limit))
    return {
        "pr_id": pr_id,
        "comments": [CommentSummary.from_api(c).model_dump() for c in comments],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        "id": result.get("id"),
        "content": result.get("content", {}).get("raw", ""),
        "inline": inline,
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def approve_pr(repo_slug: str, pr_id: int) -> dict:
    """Approve a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Approval confirmation
    """
    client = get_client()
    result = client.approve_pr(repo_slug, pr_id)
    return {
        "pr_id": pr_id,
        "approved_by": result.get("user", {}).get("display_name"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def unapprove_pr(repo_slug: str, pr_id: int) -> dict:
    """Remove your approval from a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Confirmation of approval removal
    """
    client = get_client()
    client.unapprove_pr(repo_slug, pr_id)
    return {"pr_id": pr_id}


@mcp.tool()
@handle_bitbucket_error
@formatted
def request_changes_pr(repo_slug: str, pr_id: int) -> dict:
    """Request changes on a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Confirmation of change request
    """
    client = get_client()
    result = client.request_changes_pr(repo_slug, pr_id)
    return {
        "pr_id": pr_id,
        "requested_by": result.get("user", {}).get("display_name"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def decline_pr(repo_slug: str, pr_id: int) -> dict:
    """Decline (close without merging) a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Declined PR info
    """
    client = get_client()
    result = client.decline_pr(repo_slug, pr_id)
    return {
        "pr_id": pr_id,
        "state": result.get("state"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def get_pr_diff(repo_slug: str, pr_id: int) -> dict:
    """Get the diff of a pull request.

    Args:
        repo_slug: Repository slug
        pr_id: Pull request ID

    Returns:
        Diff content as text
    """
    client = get_client()
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


# ==================== DEPLOYMENT TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_environments(repo_slug: str, limit: int = 20) -> dict:
    """List deployment environments for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 20)

    Returns:
        List of environments (e.g., test, staging, production)
    """
    client = get_client()
    environments = client.list_environments(repo_slug, limit=validate_limit(limit))
    return {
        "environments": [EnvironmentSummary.from_api(e).model_dump() for e in environments],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Environment", environment_uuid)

    return {
        "uuid": result.get("uuid"),
        "name": result.get("name"),
        "environment_type": (result.get("environment_type") or {}).get("name"),
        "rank": result.get("rank"),
        "restrictions": result.get("restrictions"),
        "lock": result.get("lock"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        repo_slug, environment_uuid, limit=validate_limit(limit)
    )
    return {
        "deployments": [DeploymentSummary.from_api(d).model_dump() for d in deployments],
    }


# ==================== WEBHOOK TOOLS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_webhooks(repo_slug: str, limit: int = 50) -> dict:
    """List webhooks configured for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of webhooks with URL, events, and status
    """
    client = get_client()
    webhooks = client.list_webhooks(repo_slug, limit=validate_limit(limit))
    return {
        "webhooks": [WebhookSummary.from_api(w).model_dump() for w in webhooks],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.create_webhook(
        repo_slug=repo_slug,
        url=url,
        events=events,
        description=description,
        active=active,
    )
    return {
        "uuid": result.get("uuid"),
        "url": result.get("url"),
        "events": result.get("events"),
        "active": result.get("active"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Webhook", webhook_uuid)

    return WebhookSummary.from_api(result).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
def delete_webhook(repo_slug: str, webhook_uuid: str) -> dict:
    """Delete a webhook.

    Args:
        repo_slug: Repository slug
        webhook_uuid: Webhook UUID (from list_webhooks)

    Returns:
        Confirmation of deletion
    """
    client = get_client()
    client.delete_webhook(repo_slug, webhook_uuid)
    return {}


# ==================== TAGS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_tags(repo_slug: str, limit: int = 50) -> dict:
    """List tags in a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of tags with name, target commit, and tagger info
    """
    client = get_client()
    tags = client.list_tags(repo_slug, limit=validate_limit(limit))
    return {
        "tags": [TagSummary.from_api(t).model_dump() for t in tags],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.create_tag(
        repo_slug,
        name=name,
        target=target,
        message=message if message else None,
    )
    return {
        "name": result.get("name"),
        "target": truncate_hash(result.get("target", {}).get("hash")),
        "message": result.get("message", ""),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def delete_tag(repo_slug: str, tag_name: str) -> dict:
    """Delete a tag from a repository.

    Args:
        repo_slug: Repository slug
        tag_name: Tag name to delete

    Returns:
        Confirmation of deletion
    """
    client = get_client()
    client.delete_tag(repo_slug, tag_name)
    return {}


# ==================== BRANCH RESTRICTIONS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_branch_restrictions(repo_slug: str, limit: int = 50) -> dict:
    """List branch restrictions (protection rules) in a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of branch restrictions with kind, pattern, and settings
    """
    client = get_client()
    restrictions = client.list_branch_restrictions(repo_slug, limit=validate_limit(limit))
    return {
        "restrictions": [BranchRestriction.from_api(r).model_dump() for r in restrictions],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.create_branch_restriction(
        repo_slug,
        kind=kind,
        pattern=pattern,
        branch_match_kind=branch_match_kind,
        branch_type=branch_type if branch_type else None,
        value=value if value else None,
    )
    return {
        "id": result.get("id"),
        "kind": result.get("kind"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def delete_branch_restriction(repo_slug: str, restriction_id: int) -> dict:
    """Delete a branch restriction.

    Args:
        repo_slug: Repository slug
        restriction_id: Restriction ID (from list_branch_restrictions)

    Returns:
        Confirmation of deletion
    """
    client = get_client()
    client.delete_branch_restriction(repo_slug, restriction_id)
    return {}


# ==================== SOURCE (FILE BROWSING) ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
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
@handle_bitbucket_error
@formatted
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
    entries = client.list_directory(repo_slug, path, ref=ref, limit=validate_limit(limit))

    return {
        "path": path or "/",
        "ref": ref,
        "entries": [DirectoryEntry.from_api(e).model_dump() for e in entries],
    }


# ==================== REPOSITORY PERMISSIONS - USERS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_user_permissions(repo_slug: str, limit: int = 50) -> dict:
    """List user permissions for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of users with their permission levels
    """
    client = get_client()
    permissions = client.list_user_permissions(repo_slug, limit=validate_limit(limit))
    return {
        "users": [UserPermission.from_api(p).model_dump() for p in permissions],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("User permission", selected_user)

    return UserPermission.from_api(result).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.update_user_permission(repo_slug, selected_user, permission)
    return {
        "user": result.get("user", {}).get("display_name"),
        "permission": result.get("permission"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def delete_user_permission(repo_slug: str, selected_user: str) -> dict:
    """Remove a user's explicit permission from a repository.

    Args:
        repo_slug: Repository slug
        selected_user: User's account_id or UUID

    Returns:
        Confirmation of removal
    """
    client = get_client()
    client.delete_user_permission(repo_slug, selected_user)
    return {}


# ==================== REPOSITORY PERMISSIONS - GROUPS ====================


@mcp.tool()
@handle_bitbucket_error
@formatted
def list_group_permissions(repo_slug: str, limit: int = 50) -> dict:
    """List group permissions for a repository.

    Args:
        repo_slug: Repository slug
        limit: Maximum number of results (default: 50)

    Returns:
        List of groups with their permission levels
    """
    client = get_client()
    permissions = client.list_group_permissions(repo_slug, limit=validate_limit(limit))
    return {
        "groups": [GroupPermission.from_api(p).model_dump() for p in permissions],
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
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
        return not_found_response("Group permission", group_slug)

    return GroupPermission.from_api(result).model_dump()


@mcp.tool()
@handle_bitbucket_error
@formatted
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
    result = client.update_group_permission(repo_slug, group_slug, permission)
    return {
        "group": result.get("group", {}).get("name"),
        "permission": result.get("permission"),
    }


@mcp.tool()
@handle_bitbucket_error
@formatted
def delete_group_permission(repo_slug: str, group_slug: str) -> dict:
    """Remove a group's explicit permission from a repository.

    Args:
        repo_slug: Repository slug
        group_slug: Group slug

    Returns:
        Confirmation of removal
    """
    client = get_client()
    client.delete_group_permission(repo_slug, group_slug)
    return {}


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
