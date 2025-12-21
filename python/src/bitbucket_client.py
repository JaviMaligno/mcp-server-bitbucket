"""Bitbucket API client for MCP server.

Provides all Bitbucket API operations needed by the MCP tools:
- Repositories: get, create, delete, list, update
- Pull Requests: create, get, list, merge, approve, decline, comments, diff
- Pipelines: trigger, get, list, logs, stop
- Branches: list, get
- Commits: list, get, compare, statuses
- Deployments: environments, deployment history
- Webhooks: list, create, get, delete
"""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from src.settings import get_settings
from src.utils import ensure_uuid_braces


class BitbucketError(Exception):
    """Exception for Bitbucket API errors."""
    pass


class BitbucketClient:
    """Client for Bitbucket API operations.

    Uses connection pooling for better performance when making
    multiple requests. Includes automatic retry with exponential
    backoff for rate-limited requests (HTTP 429).

    Configuration via environment variables:
        API_TIMEOUT: Request timeout in seconds (default: 30, max: 300)
        MAX_RETRIES: Max retry attempts for rate limiting (default: 3, max: 10)
    """

    BASE_URL = "https://api.bitbucket.org/2.0"
    INITIAL_BACKOFF = 1.0  # seconds

    def __init__(
        self,
        workspace: Optional[str] = None,
        email: Optional[str] = None,
        api_token: Optional[str] = None,
        timeout: Optional[int] = None,
        max_retries: Optional[int] = None,
    ):
        """Initialize Bitbucket client.

        Args:
            workspace: Bitbucket workspace (default from settings)
            email: Bitbucket email for auth (default from settings)
            api_token: Bitbucket access token (default from settings)
            timeout: Request timeout in seconds (default from settings)
            max_retries: Max retry attempts for rate limiting (default from settings)
        """
        settings = get_settings()

        self.workspace = workspace or settings.bitbucket_workspace
        self.email = email or settings.bitbucket_email
        # Handle SecretStr - get the secret value if it's a SecretStr
        token = api_token or settings.bitbucket_api_token
        self.api_token = token.get_secret_value() if hasattr(token, "get_secret_value") else token

        # Configurable timeout and retries
        self.timeout = timeout if timeout is not None else settings.api_timeout
        self.max_retries = max_retries if max_retries is not None else settings.max_retries

        # Connection pooling - reuse HTTP client for multiple requests
        self._client: Optional[httpx.Client] = None

    def _get_http_client(self) -> httpx.Client:
        """Get or create the HTTP client with connection pooling."""
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.timeout,
                auth=(self.email, self.api_token),
                follow_redirects=True,
            )
        return self._client

    def close(self) -> None:
        """Close the HTTP client and release connections."""
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self) -> "BitbucketClient":
        """Context manager entry."""
        return self

    def __exit__(self, *args) -> None:
        """Context manager exit - close client."""
        self.close()

    def _get_auth(self) -> tuple[str, str]:
        """Get auth tuple for Basic Auth requests."""
        return (self.email, self.api_token)

    def _url(self, path: str) -> str:
        """Build full API URL."""
        return f"{self.BASE_URL}/{path.lstrip('/')}"

    def _repo_path(self, repo_slug: str, *parts: str) -> str:
        """Build repository endpoint path.

        Args:
            repo_slug: Repository slug
            *parts: Additional path segments

        Returns:
            Full path like "repositories/workspace/repo/pullrequests/123"
        """
        base = f"repositories/{self.workspace}/{repo_slug}"
        return "/".join([base] + list(parts)) if parts else base

    def _request(
        self,
        method: str,
        path: str,
        json: Optional[dict] = None,
        params: Optional[dict] = None,
        timeout: Optional[int] = None,
    ) -> Optional[dict]:
        """Make an API request using connection pooling with retry logic.

        Automatically retries on rate limiting (HTTP 429) with exponential backoff.

        Args:
            method: HTTP method
            path: API path (without base URL)
            json: Request body
            params: Query parameters
            timeout: Request timeout in seconds (uses default if not specified)

        Returns:
            Response JSON or None for 204/404
        """
        client = self._get_http_client()
        backoff = self.INITIAL_BACKOFF

        for attempt in range(self.max_retries + 1):
            r = client.request(
                method,
                self._url(path),
                json=json,
                params=params,
                headers={"Content-Type": "application/json"} if json else None,
                timeout=timeout or self.timeout,
            )

            if r.status_code == 404:
                return None
            if r.status_code in (200, 201, 202):
                return r.json() if r.content else {}
            if r.status_code == 204:
                return {}

            # Rate limiting - retry with exponential backoff
            if r.status_code == 429:
                if attempt < self.max_retries:
                    # Check Retry-After header for server-suggested wait time
                    retry_after = r.headers.get("Retry-After")
                    if retry_after:
                        try:
                            wait_time = float(retry_after)
                        except ValueError:
                            wait_time = backoff
                    else:
                        wait_time = backoff

                    time.sleep(wait_time)
                    backoff *= 2  # Exponential backoff
                    continue
                else:
                    raise BitbucketError(
                        f"Rate limited after {self.max_retries} retries. "
                        f"Method: {method} {path}"
                    )

            # Truncate error response to avoid huge exception messages
            error_text = r.text[:500] if len(r.text) > 500 else r.text
            raise BitbucketError(
                f"API error {r.status_code}: {error_text}\n"
                f"Method: {method} {path}"
            )

        # Should not reach here, but satisfy type checker
        raise BitbucketError(f"Unexpected error in request: {method} {path}")

    def _paginated_list(
        self,
        endpoint: str,
        limit: int = 50,
        max_page: int = 100,
        **extra_params,
    ) -> list[dict[str, Any]]:
        """Helper for paginated list endpoints.

        Args:
            endpoint: API endpoint path
            limit: Maximum results to return
            max_page: Maximum page size (API limit)
            **extra_params: Additional query parameters

        Returns:
            List of result dicts from 'values' key
        """
        params = {"pagelen": min(limit, max_page)}
        params.update({k: v for k, v in extra_params.items() if v is not None})
        result = self._request("GET", endpoint, params=params)
        return result.get("values", []) if result else []

    def _request_text(
        self,
        path: str,
        timeout: Optional[int] = None,
    ) -> Optional[str]:
        """Make an API request that returns plain text using connection pooling.

        Used for endpoints that return text content like logs, diffs, and files.
        Follows redirects automatically. Includes retry logic for rate limiting.

        Args:
            path: API path (without base URL)
            timeout: Request timeout in seconds (uses default if not specified)

        Returns:
            Response text or None for 404
        """
        client = self._get_http_client()
        backoff = self.INITIAL_BACKOFF

        for attempt in range(self.max_retries + 1):
            r = client.get(
                self._url(path),
                timeout=timeout or self.timeout,
            )

            if r.status_code == 200:
                return r.text
            elif r.status_code == 404:
                return None
            elif r.status_code == 429:
                if attempt < self.max_retries:
                    retry_after = r.headers.get("Retry-After")
                    wait_time = float(retry_after) if retry_after else backoff
                    time.sleep(wait_time)
                    backoff *= 2
                    continue
                else:
                    raise BitbucketError(f"Rate limited after {self.max_retries} retries")
            else:
                raise BitbucketError(f"Request failed: {r.status_code}")

        raise BitbucketError(f"Unexpected error in request: GET {path}")

    def _require_result(
        self,
        result: Optional[dict[str, Any]],
        action: str,
        identifier: str = "",
    ) -> dict[str, Any]:
        """Validate that a result is not None/empty.

        Args:
            result: API response to validate
            action: Action description for error message (e.g., "create repository")
            identifier: Optional identifier for error message (e.g., repo name)

        Returns:
            The result if valid

        Raises:
            BitbucketError: If result is None or empty
        """
        if not result:
            msg = f"Failed to {action}"
            if identifier:
                msg += f": {identifier}"
            raise BitbucketError(msg)
        return result

    # ==================== REPOSITORIES ====================

    def get_repository(self, repo_slug: str) -> Optional[dict[str, Any]]:
        """Get repository information.

        Args:
            repo_slug: Repository slug

        Returns:
            Repository info or None if not found
        """
        return self._request("GET", self._repo_path(repo_slug))

    def create_repository(
        self,
        repo_slug: str,
        project_key: Optional[str] = None,
        is_private: bool = True,
        description: str = "",
    ) -> dict[str, Any]:
        """Create a new repository.

        Args:
            repo_slug: Repository slug
            project_key: Project key to create repo under
            is_private: Whether repo is private (default: True)
            description: Repository description

        Returns:
            Created repository info
        """
        payload = {
            "scm": "git",
            "is_private": is_private,
        }
        if project_key:
            payload["project"] = {"key": project_key}
        if description:
            payload["description"] = description

        result = self._request("POST", self._repo_path(repo_slug), json=payload)
        return self._require_result(result, "create repository", repo_slug)

    def delete_repository(self, repo_slug: str) -> bool:
        """Delete a repository.

        Args:
            repo_slug: Repository slug

        Returns:
            True if deleted successfully
        """
        self._request("DELETE", self._repo_path(repo_slug))
        return True

    def list_repositories(
        self,
        project_key: Optional[str] = None,
        query: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List repositories in workspace.

        Args:
            project_key: Filter by project (optional)
            query: Search query using Bitbucket query syntax (optional)
                   Examples:
                   - name ~ "anzsic" (partial name match)
                   - name = "exact-name" (exact name match)
                   - description ~ "api" (search in description)
                   - is_private = true (filter by visibility)
            limit: Maximum results to return

        Returns:
            List of repository info dicts
        """
        params = {"pagelen": min(limit, 100)}

        # Build query string
        q_parts = []
        if project_key:
            q_parts.append(f'project.key="{project_key}"')
        if query:
            q_parts.append(query)

        if q_parts:
            params["q"] = " AND ".join(q_parts)

        result = self._request(
            "GET",
            f"repositories/{self.workspace}",
            params=params,
        )
        return result.get("values", []) if result else []

    # ==================== PULL REQUESTS ====================

    def create_pull_request(
        self,
        repo_slug: str,
        title: str,
        source_branch: str,
        destination_branch: str = "main",
        description: str = "",
        close_source_branch: bool = True,
        reviewers: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Create a pull request.

        Args:
            repo_slug: Repository slug
            title: PR title
            source_branch: Source branch name
            destination_branch: Target branch (default: main)
            description: PR description body
            close_source_branch: Delete branch after merge
            reviewers: List of reviewer account IDs (optional)

        Returns:
            Dict with PR info including 'id', 'links', 'state'
        """
        payload = {
            "title": title,
            "source": {"branch": {"name": source_branch}},
            "destination": {"branch": {"name": destination_branch}},
            "close_source_branch": close_source_branch,
        }
        if description:
            payload["description"] = description
        if reviewers:
            # Handle both UUID format and account_id format
            payload["reviewers"] = [
                {"uuid": r} if r.startswith("{") else {"account_id": r}
                for r in reviewers
            ]

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pullrequests"),
            json=payload,
        )
        return self._require_result(
            result, "create PR", f"{source_branch} -> {destination_branch}"
        )

    def get_pull_request(
        self, repo_slug: str, pr_id: int
    ) -> Optional[dict[str, Any]]:
        """Get pull request by ID.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID

        Returns:
            PR info or None if not found
        """
        return self._request(
            "GET",
            self._repo_path(repo_slug, "pullrequests", str(pr_id)),
        )

    def list_pull_requests(
        self,
        repo_slug: str,
        state: str = "OPEN",
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List pull requests for a repository.

        Args:
            repo_slug: Repository slug
            state: PR state filter (OPEN, MERGED, DECLINED, SUPERSEDED)
            limit: Maximum results to return

        Returns:
            List of PR info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "pullrequests"),
            limit=limit,
            max_page=50,
            state=state,
        )

    def merge_pull_request(
        self,
        repo_slug: str,
        pr_id: int,
        merge_strategy: str = "merge_commit",
        close_source_branch: bool = True,
        message: Optional[str] = None,
    ) -> dict[str, Any]:
        """Merge a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID
            merge_strategy: One of 'merge_commit', 'squash', 'fast_forward'
            close_source_branch: Delete source branch after merge
            message: Optional merge commit message

        Returns:
            Merged PR info
        """
        payload = {
            "type": merge_strategy,
            "close_source_branch": close_source_branch,
        }
        if message:
            payload["message"] = message

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "merge"),
            json=payload,
        )
        return self._require_result(result, "merge PR", f"#{pr_id}")

    # ==================== PIPELINES ====================

    def trigger_pipeline(
        self,
        repo_slug: str,
        branch: str = "main",
        variables: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        """Trigger a pipeline run.

        Args:
            repo_slug: Repository slug
            branch: Branch to run pipeline on (default: main)
            variables: Custom pipeline variables

        Returns:
            Pipeline run info including 'uuid', 'state'
        """
        payload = {
            "target": {
                "ref_type": "branch",
                "type": "pipeline_ref_target",
                "ref_name": branch,
            }
        }
        if variables:
            payload["variables"] = [
                {"key": k, "value": v} for k, v in variables.items()
            ]

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pipelines") + "/",
            json=payload,
        )
        return self._require_result(result, "trigger pipeline on", branch)

    def get_pipeline(
        self, repo_slug: str, pipeline_uuid: str
    ) -> Optional[dict[str, Any]]:
        """Get pipeline run status.

        Args:
            repo_slug: Repository slug
            pipeline_uuid: Pipeline UUID (with or without braces)

        Returns:
            Pipeline info or None if not found
        """
        pipeline_uuid = ensure_uuid_braces(pipeline_uuid)
        return self._request(
            "GET",
            self._repo_path(repo_slug, "pipelines", pipeline_uuid),
        )

    def list_pipelines(
        self,
        repo_slug: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """List recent pipeline runs.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of pipeline info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "pipelines") + "/",
            limit=limit,
            sort="-created_on",
        )

    def get_pipeline_steps(
        self, repo_slug: str, pipeline_uuid: str
    ) -> list[dict[str, Any]]:
        """Get pipeline steps.

        Args:
            repo_slug: Repository slug
            pipeline_uuid: Pipeline UUID

        Returns:
            List of step info dicts
        """
        pipeline_uuid = ensure_uuid_braces(pipeline_uuid)
        return self._paginated_list(
            self._repo_path(repo_slug, "pipelines", pipeline_uuid, "steps") + "/",
        )

    def get_pipeline_logs(
        self,
        repo_slug: str,
        pipeline_uuid: str,
        step_uuid: str,
    ) -> str:
        """Get logs for a pipeline step.

        Args:
            repo_slug: Repository slug
            pipeline_uuid: Pipeline UUID
            step_uuid: Step UUID

        Returns:
            Log content as string
        """
        pipeline_uuid = ensure_uuid_braces(pipeline_uuid)
        step_uuid = ensure_uuid_braces(step_uuid)
        path = self._repo_path(
            repo_slug, "pipelines", pipeline_uuid, "steps", step_uuid, "log"
        )
        return self._request_text(path) or ""

    def stop_pipeline(
        self, repo_slug: str, pipeline_uuid: str
    ) -> dict[str, Any]:
        """Stop a running pipeline.

        Args:
            repo_slug: Repository slug
            pipeline_uuid: Pipeline UUID

        Returns:
            Updated pipeline info
        """
        pipeline_uuid = ensure_uuid_braces(pipeline_uuid)
        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pipelines", pipeline_uuid, "stopPipeline"),
        )
        # 204 returns {} which is a success
        if result is None:
            raise BitbucketError(f"Failed to stop pipeline {pipeline_uuid}")
        # Return updated pipeline state
        return self.get_pipeline(repo_slug, pipeline_uuid) or {"stopped": True}

    # ==================== PIPELINE VARIABLES ====================

    def list_pipeline_variables(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List pipeline variables for a repository.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of pipeline variable info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "pipelines_config", "variables"),
            limit=limit,
        )

    def get_pipeline_variable(
        self, repo_slug: str, variable_uuid: str
    ) -> Optional[dict[str, Any]]:
        """Get a specific pipeline variable.

        Args:
            repo_slug: Repository slug
            variable_uuid: Variable UUID

        Returns:
            Variable info or None if not found
        """
        variable_uuid = ensure_uuid_braces(variable_uuid)
        return self._request(
            "GET",
            self._repo_path(repo_slug, "pipelines_config", "variables", variable_uuid),
        )

    def create_pipeline_variable(
        self,
        repo_slug: str,
        key: str,
        value: str,
        secured: bool = False,
    ) -> dict[str, Any]:
        """Create a pipeline variable.

        Args:
            repo_slug: Repository slug
            key: Variable name (e.g., "PYPI_TOKEN")
            value: Variable value
            secured: Whether to encrypt the value (default: False)

        Returns:
            Created variable info
        """
        payload = {"key": key, "value": value, "secured": secured}
        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pipelines_config", "variables") + "/",
            json=payload,
        )
        return self._require_result(result, "create pipeline variable")

    def update_pipeline_variable(
        self,
        repo_slug: str,
        variable_uuid: str,
        value: str,
    ) -> dict[str, Any]:
        """Update a pipeline variable's value.

        Args:
            repo_slug: Repository slug
            variable_uuid: Variable UUID
            value: New variable value

        Returns:
            Updated variable info
        """
        variable_uuid = ensure_uuid_braces(variable_uuid)
        result = self._request(
            "PUT",
            self._repo_path(repo_slug, "pipelines_config", "variables", variable_uuid),
            json={"value": value},
        )
        return self._require_result(result, "update pipeline variable")

    def delete_pipeline_variable(
        self, repo_slug: str, variable_uuid: str
    ) -> bool:
        """Delete a pipeline variable.

        Args:
            repo_slug: Repository slug
            variable_uuid: Variable UUID

        Returns:
            True if deleted successfully
        """
        variable_uuid = ensure_uuid_braces(variable_uuid)
        self._request(
            "DELETE",
            self._repo_path(repo_slug, "pipelines_config", "variables", variable_uuid),
        )
        return True

    # ==================== PROJECTS ====================

    def list_projects(
        self,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List projects in workspace.

        Args:
            limit: Maximum results to return

        Returns:
            List of project info dicts
        """
        return self._paginated_list(
            f"workspaces/{self.workspace}/projects",
            limit=limit,
        )

    def get_project(self, project_key: str) -> Optional[dict[str, Any]]:
        """Get project information.

        Args:
            project_key: Project key (e.g., "DS")

        Returns:
            Project info or None if not found
        """
        return self._request(
            "GET",
            f"workspaces/{self.workspace}/projects/{project_key}",
        )

    # ==================== REPOSITORY UPDATE ====================

    def update_repository(
        self,
        repo_slug: str,
        project_key: Optional[str] = None,
        is_private: Optional[bool] = None,
        description: Optional[str] = None,
        name: Optional[str] = None,
    ) -> dict[str, Any]:
        """Update repository settings.

        Args:
            repo_slug: Repository slug
            project_key: Move to different project (optional)
            is_private: Change visibility (optional)
            description: Update description (optional)
            name: Rename repository (optional)

        Returns:
            Updated repository info
        """
        payload = {}
        if project_key is not None:
            payload["project"] = {"key": project_key}
        if is_private is not None:
            payload["is_private"] = is_private
        if description is not None:
            payload["description"] = description
        if name is not None:
            payload["name"] = name

        if not payload:
            raise BitbucketError("No fields to update")

        result = self._request("PUT", self._repo_path(repo_slug), json=payload)
        return self._require_result(result, "update repository", repo_slug)

    # ==================== COMMITS ====================

    def list_commits(
        self,
        repo_slug: str,
        branch: Optional[str] = None,
        path: Optional[str] = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """List commits in a repository.

        Args:
            repo_slug: Repository slug
            branch: Filter by branch (optional)
            path: Filter by file path (optional)
            limit: Maximum results to return

        Returns:
            List of commit info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "commits"),
            limit=limit,
            include=branch,
            path=path,
        )

    def get_commit(
        self, repo_slug: str, commit: str
    ) -> Optional[dict[str, Any]]:
        """Get commit details.

        Args:
            repo_slug: Repository slug
            commit: Commit hash (full or short)

        Returns:
            Commit info or None if not found
        """
        return self._request("GET", self._repo_path(repo_slug, "commit", commit))

    def compare_commits(
        self,
        repo_slug: str,
        base: str,
        head: str,
    ) -> Optional[dict[str, Any]]:
        """Compare two commits or branches (get diff).

        Args:
            repo_slug: Repository slug
            base: Base commit/branch
            head: Head commit/branch

        Returns:
            Diff info including files changed
        """
        # Use diffstat for summary, diff for full content
        return self._request(
            "GET",
            self._repo_path(repo_slug, "diffstat", f"{base}..{head}"),
        )

    # ==================== COMMIT STATUSES ====================

    def get_commit_statuses(
        self,
        repo_slug: str,
        commit: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Get build/CI statuses for a commit.

        Args:
            repo_slug: Repository slug
            commit: Commit hash
            limit: Maximum results to return

        Returns:
            List of status info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "commit", commit, "statuses"),
            limit=limit,
        )

    def create_commit_status(
        self,
        repo_slug: str,
        commit: str,
        state: str,
        key: str,
        url: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a build status for a commit.

        Args:
            repo_slug: Repository slug
            commit: Commit hash
            state: Status state (SUCCESSFUL, FAILED, INPROGRESS, STOPPED)
            key: Unique identifier for this status
            url: URL to the build (optional)
            name: Display name (optional)
            description: Status description (optional)

        Returns:
            Created status info
        """
        payload = {
            "state": state,
            "key": key,
        }
        if url:
            payload["url"] = url
        if name:
            payload["name"] = name
        if description:
            payload["description"] = description

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "commit", commit, "statuses", "build"),
            json=payload,
        )
        return self._require_result(result, "create status for commit", commit)

    # ==================== PR COMMENTS & REVIEWS ====================

    def list_pr_comments(
        self,
        repo_slug: str,
        pr_id: int,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List comments on a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID
            limit: Maximum results to return

        Returns:
            List of comment info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "comments"),
            limit=limit,
        )

    def add_pr_comment(
        self,
        repo_slug: str,
        pr_id: int,
        content: str,
        inline: Optional[dict] = None,
    ) -> dict[str, Any]:
        """Add a comment to a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID
            content: Comment content (markdown supported)
            inline: Inline comment location (optional)
                    {"path": "file.py", "to": 10} for line comment

        Returns:
            Created comment info
        """
        payload = {
            "content": {"raw": content}
        }
        if inline:
            payload["inline"] = inline

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "comments"),
            json=payload,
        )
        return self._require_result(result, "add comment to PR", f"#{pr_id}")

    def approve_pr(
        self, repo_slug: str, pr_id: int
    ) -> dict[str, Any]:
        """Approve a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID

        Returns:
            Approval info
        """
        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "approve"),
        )
        return self._require_result(result, "approve PR", f"#{pr_id}")

    def unapprove_pr(
        self, repo_slug: str, pr_id: int
    ) -> bool:
        """Remove approval from a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID

        Returns:
            True if successful
        """
        self._request(
            "DELETE",
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "approve"),
        )
        return True

    def request_changes_pr(
        self, repo_slug: str, pr_id: int
    ) -> dict[str, Any]:
        """Request changes on a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID

        Returns:
            Request info
        """
        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "request-changes"),
        )
        return self._require_result(result, "request changes on PR", f"#{pr_id}")

    def decline_pr(
        self, repo_slug: str, pr_id: int
    ) -> dict[str, Any]:
        """Decline (close) a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID

        Returns:
            Declined PR info
        """
        result = self._request(
            "POST",
            self._repo_path(repo_slug, "pullrequests", str(pr_id), "decline"),
        )
        return self._require_result(result, "decline PR", f"#{pr_id}")

    def get_pr_diff(
        self, repo_slug: str, pr_id: int
    ) -> str:
        """Get diff of a pull request.

        Args:
            repo_slug: Repository slug
            pr_id: Pull request ID

        Returns:
            Diff content as string
        """
        path = self._repo_path(repo_slug, "pullrequests", str(pr_id), "diff")
        return self._request_text(path) or ""

    # ==================== DEPLOYMENTS ====================

    def list_environments(
        self,
        repo_slug: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """List deployment environments.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of environment info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "environments"),
            limit=limit,
        )

    def get_environment(
        self, repo_slug: str, environment_uuid: str
    ) -> Optional[dict[str, Any]]:
        """Get deployment environment details.

        Args:
            repo_slug: Repository slug
            environment_uuid: Environment UUID

        Returns:
            Environment info or None if not found
        """
        environment_uuid = ensure_uuid_braces(environment_uuid)
        return self._request(
            "GET",
            self._repo_path(repo_slug, "environments", environment_uuid),
        )

    def list_deployment_history(
        self,
        repo_slug: str,
        environment_uuid: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Get deployment history for an environment.

        Args:
            repo_slug: Repository slug
            environment_uuid: Environment UUID
            limit: Maximum results to return

        Returns:
            List of deployment info dicts
        """
        environment_uuid = ensure_uuid_braces(environment_uuid)
        return self._paginated_list(
            self._repo_path(repo_slug, "deployments"),
            limit=limit,
            environment=environment_uuid,
            sort="-state.started_on",
        )

    # ==================== WEBHOOKS ====================

    def list_webhooks(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List webhooks for a repository.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of webhook info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "hooks"),
            limit=limit,
        )

    def create_webhook(
        self,
        repo_slug: str,
        url: str,
        events: list[str],
        description: str = "",
        active: bool = True,
    ) -> dict[str, Any]:
        """Create a webhook.

        Args:
            repo_slug: Repository slug
            url: Webhook URL to call
            events: List of events to trigger on
                    e.g., ["repo:push", "pullrequest:created", "pullrequest:merged"]
            description: Webhook description
            active: Whether webhook is active

        Returns:
            Created webhook info
        """
        payload = {
            "url": url,
            "events": events,
            "active": active,
        }
        if description:
            payload["description"] = description

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "hooks"),
            json=payload,
        )
        return self._require_result(result, "create webhook")

    def get_webhook(
        self, repo_slug: str, webhook_uid: str
    ) -> Optional[dict[str, Any]]:
        """Get webhook details.

        Args:
            repo_slug: Repository slug
            webhook_uid: Webhook UID

        Returns:
            Webhook info or None if not found
        """
        webhook_uid = ensure_uuid_braces(webhook_uid)
        return self._request(
            "GET",
            self._repo_path(repo_slug, "hooks", webhook_uid),
        )

    def delete_webhook(
        self, repo_slug: str, webhook_uid: str
    ) -> bool:
        """Delete a webhook.

        Args:
            repo_slug: Repository slug
            webhook_uid: Webhook UID

        Returns:
            True if deleted successfully
        """
        webhook_uid = ensure_uuid_braces(webhook_uid)
        self._request("DELETE", self._repo_path(repo_slug, "hooks", webhook_uid))
        return True

    # ==================== BRANCHES ====================

    def list_branches(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List branches in a repository.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of branch info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "refs", "branches"),
            limit=limit,
        )

    def get_branch(
        self, repo_slug: str, branch_name: str
    ) -> Optional[dict[str, Any]]:
        """Get branch information.

        Args:
            repo_slug: Repository slug
            branch_name: Branch name

        Returns:
            Branch info or None if not found
        """
        return self._request(
            "GET",
            self._repo_path(repo_slug, "refs", "branches", branch_name),
        )

    # ==================== TAGS ====================

    def list_tags(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List tags in a repository.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of tag info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "refs", "tags"),
            limit=limit,
            sort="-target.date",
        )

    def create_tag(
        self,
        repo_slug: str,
        name: str,
        target: str,
        message: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a tag.

        Args:
            repo_slug: Repository slug
            name: Tag name (e.g., "v1.0.0")
            target: Commit hash or branch to tag
            message: Optional tag message (for annotated tags)

        Returns:
            Created tag info
        """
        payload = {
            "name": name,
            "target": {"hash": target},
        }
        if message:
            payload["message"] = message

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "refs", "tags"),
            json=payload,
        )
        return self._require_result(result, "create tag", name)

    def delete_tag(
        self, repo_slug: str, tag_name: str
    ) -> bool:
        """Delete a tag.

        Args:
            repo_slug: Repository slug
            tag_name: Tag name to delete

        Returns:
            True if deleted successfully
        """
        self._request(
            "DELETE",
            self._repo_path(repo_slug, "refs", "tags", tag_name),
        )
        return True

    # ==================== BRANCH RESTRICTIONS ====================

    def list_branch_restrictions(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List branch restrictions.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of restriction info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "branch-restrictions"),
            limit=limit,
        )

    def create_branch_restriction(
        self,
        repo_slug: str,
        kind: str,
        pattern: str = "",
        branch_match_kind: str = "glob",
        branch_type: Optional[str] = None,
        users: Optional[list[dict]] = None,
        groups: Optional[list[dict]] = None,
        value: Optional[int] = None,
    ) -> dict[str, Any]:
        """Create a branch restriction.

        Args:
            repo_slug: Repository slug
            kind: Restriction type. Options:
                  - require_passing_builds_to_merge
                  - require_approvals_to_merge
                  - require_default_reviewer_approvals_to_merge
                  - require_no_changes_requested
                  - require_tasks_to_be_completed
                  - require_commits_behind
                  - push, force, delete, restrict_merges
            pattern: Branch pattern (e.g., "main", "release/*")
            branch_match_kind: "glob" or "branching_model"
            branch_type: If branch_match_kind is "branching_model":
                         development, production, feature, bugfix, release, hotfix
            users: List of users exempt from restriction
            groups: List of groups exempt from restriction
            value: Number value (e.g., required approvals count)

        Returns:
            Created restriction info
        """
        payload: dict[str, Any] = {
            "kind": kind,
            "branch_match_kind": branch_match_kind,
        }

        if branch_match_kind == "glob" and pattern:
            payload["pattern"] = pattern
        if branch_match_kind == "branching_model" and branch_type:
            payload["branch_type"] = branch_type
        if users:
            payload["users"] = users
        if groups:
            payload["groups"] = groups
        if value is not None:
            payload["value"] = value

        result = self._request(
            "POST",
            self._repo_path(repo_slug, "branch-restrictions"),
            json=payload,
        )
        return self._require_result(result, "create branch restriction", kind)

    def delete_branch_restriction(
        self, repo_slug: str, restriction_id: int
    ) -> bool:
        """Delete a branch restriction.

        Args:
            repo_slug: Repository slug
            restriction_id: Restriction ID to delete

        Returns:
            True if deleted successfully
        """
        self._request(
            "DELETE",
            self._repo_path(repo_slug, "branch-restrictions", str(restriction_id)),
        )
        return True

    # ==================== SOURCE ====================

    def get_file_content(
        self,
        repo_slug: str,
        path: str,
        ref: str = "main",
    ) -> Optional[str]:
        """Get file content from repository.

        Args:
            repo_slug: Repository slug
            path: File path (e.g., "src/main.py")
            ref: Branch, tag, or commit (default: main)

        Returns:
            File content as string or None if not found
        """
        return self._request_text(self._repo_path(repo_slug, "src", ref, path))

    def list_directory(
        self,
        repo_slug: str,
        path: str = "",
        ref: str = "main",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List directory contents.

        Args:
            repo_slug: Repository slug
            path: Directory path (empty for root)
            ref: Branch, tag, or commit (default: main)
            limit: Maximum results to return

        Returns:
            List of file/directory info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "src", ref, path) if path else self._repo_path(repo_slug, "src", ref),
            limit=limit,
        )

    # ==================== REPOSITORY PERMISSIONS ====================

    def list_user_permissions(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List user permissions for a repository.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of user permission info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "permissions-config", "users"),
            limit=limit,
        )

    def get_user_permission(
        self, repo_slug: str, selected_user: str
    ) -> Optional[dict[str, Any]]:
        """Get permission for a specific user.

        Args:
            repo_slug: Repository slug
            selected_user: User UUID or account_id

        Returns:
            User permission info or None if not found
        """
        return self._request(
            "GET",
            self._repo_path(repo_slug, "permissions-config", "users", selected_user),
        )

    def update_user_permission(
        self,
        repo_slug: str,
        selected_user: str,
        permission: str,
    ) -> dict[str, Any]:
        """Update (or add) user permission.

        Args:
            repo_slug: Repository slug
            selected_user: User UUID or account_id
            permission: Permission level: "read", "write", or "admin"

        Returns:
            Updated permission info
        """
        result = self._request(
            "PUT",
            self._repo_path(repo_slug, "permissions-config", "users", selected_user),
            json={"permission": permission},
        )
        return self._require_result(result, "update permission for user", selected_user)

    def delete_user_permission(
        self, repo_slug: str, selected_user: str
    ) -> bool:
        """Remove user permission from repository.

        Args:
            repo_slug: Repository slug
            selected_user: User UUID or account_id

        Returns:
            True if deleted successfully
        """
        self._request(
            "DELETE",
            self._repo_path(repo_slug, "permissions-config", "users", selected_user),
        )
        return True

    def list_group_permissions(
        self,
        repo_slug: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List group permissions for a repository.

        Args:
            repo_slug: Repository slug
            limit: Maximum results to return

        Returns:
            List of group permission info dicts
        """
        return self._paginated_list(
            self._repo_path(repo_slug, "permissions-config", "groups"),
            limit=limit,
        )

    def get_group_permission(
        self, repo_slug: str, group_slug: str
    ) -> Optional[dict[str, Any]]:
        """Get permission for a specific group.

        Args:
            repo_slug: Repository slug
            group_slug: Group slug

        Returns:
            Group permission info or None if not found
        """
        return self._request(
            "GET",
            self._repo_path(repo_slug, "permissions-config", "groups", group_slug),
        )

    def update_group_permission(
        self,
        repo_slug: str,
        group_slug: str,
        permission: str,
    ) -> dict[str, Any]:
        """Update (or add) group permission.

        Args:
            repo_slug: Repository slug
            group_slug: Group slug
            permission: Permission level: "read", "write", or "admin"

        Returns:
            Updated permission info
        """
        result = self._request(
            "PUT",
            self._repo_path(repo_slug, "permissions-config", "groups", group_slug),
            json={"permission": permission},
        )
        return self._require_result(result, "update permission for group", group_slug)

    def delete_group_permission(
        self, repo_slug: str, group_slug: str
    ) -> bool:
        """Remove group permission from repository.

        Args:
            repo_slug: Repository slug
            group_slug: Group slug

        Returns:
            True if deleted successfully
        """
        self._request(
            "DELETE",
            self._repo_path(repo_slug, "permissions-config", "groups", group_slug),
        )
        return True

    # ==================== UTILITIES ====================

    @staticmethod
    def extract_pr_url(pr_response: dict[str, Any]) -> str:
        """Extract the HTML URL from a PR response."""
        return pr_response.get("links", {}).get("html", {}).get("href", "")

    @staticmethod
    def extract_clone_urls(repo_response: dict[str, Any]) -> dict[str, str]:
        """Extract clone URLs from a repository response."""
        urls = {}
        for link in repo_response.get("links", {}).get("clone", []):
            name = link.get("name", "").lower()
            if name in ("https", "ssh"):
                urls[name] = link.get("href", "")
        urls["html"] = repo_response.get("links", {}).get("html", {}).get("href", "")
        return urls


# Singleton instance
_client: Optional[BitbucketClient] = None


def get_client() -> BitbucketClient:
    """Get or create the Bitbucket client singleton."""
    global _client
    if _client is None:
        _client = BitbucketClient()
    return _client
