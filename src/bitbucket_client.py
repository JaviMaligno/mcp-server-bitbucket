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

import os
from typing import Any, Optional

import httpx
from dotenv import load_dotenv


class BitbucketError(Exception):
    """Exception for Bitbucket API errors."""
    pass


class BitbucketClient:
    """Client for Bitbucket API operations."""

    BASE_URL = "https://api.bitbucket.org/2.0"

    def __init__(
        self,
        workspace: Optional[str] = None,
        email: Optional[str] = None,
        api_token: Optional[str] = None,
    ):
        """Initialize Bitbucket client.

        Args:
            workspace: Bitbucket workspace (default from env)
            email: Bitbucket email for auth (default from env)
            api_token: Bitbucket access token (default from env)
        """
        load_dotenv(override=True)

        self.workspace = workspace or os.getenv("BITBUCKET_WORKSPACE", "simplekyc")
        self.email = email or os.getenv("BITBUCKET_EMAIL")
        self.api_token = api_token or os.getenv("BITBUCKET_API_TOKEN")

        if not self.email or not self.api_token:
            raise BitbucketError(
                "Missing Bitbucket credentials. Set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN"
            )

    def _get_auth(self) -> tuple[str, str]:
        """Get auth tuple for Basic Auth requests."""
        return (self.email, self.api_token)

    def _url(self, path: str) -> str:
        """Build full API URL."""
        return f"{self.BASE_URL}/{path.lstrip('/')}"

    def _request(
        self,
        method: str,
        path: str,
        json: Optional[dict] = None,
        params: Optional[dict] = None,
        timeout: int = 30,
    ) -> Optional[dict]:
        """Make an API request.

        Args:
            method: HTTP method
            path: API path (without base URL)
            json: Request body
            params: Query parameters
            timeout: Request timeout in seconds

        Returns:
            Response JSON or None for 204/404
        """
        with httpx.Client(timeout=timeout) as client:
            r = client.request(
                method,
                self._url(path),
                auth=self._get_auth(),
                json=json,
                params=params,
                headers={"Content-Type": "application/json"} if json else None,
            )

            if r.status_code == 404:
                return None
            if r.status_code in (200, 201, 202):
                return r.json() if r.content else {}
            if r.status_code == 204:
                return {}

            raise BitbucketError(
                f"API error {r.status_code}: {r.text}\n"
                f"Method: {method} {path}"
            )

    # ==================== REPOSITORIES ====================

    def get_repository(self, repo_slug: str) -> Optional[dict[str, Any]]:
        """Get repository information.

        Args:
            repo_slug: Repository slug

        Returns:
            Repository info or None if not found
        """
        return self._request("GET", f"repositories/{self.workspace}/{repo_slug}")

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

        result = self._request(
            "POST",
            f"repositories/{self.workspace}/{repo_slug}",
            json=payload,
        )
        if not result:
            raise BitbucketError(f"Failed to create repository: {repo_slug}")
        return result

    def delete_repository(self, repo_slug: str) -> bool:
        """Delete a repository.

        Args:
            repo_slug: Repository slug

        Returns:
            True if deleted successfully
        """
        self._request("DELETE", f"repositories/{self.workspace}/{repo_slug}")
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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests",
            json=payload,
        )
        if not result:
            raise BitbucketError(
                f"Failed to create PR: {source_branch} -> {destination_branch}"
            )
        return result

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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}",
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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/pullrequests",
            params={"state": state, "pagelen": min(limit, 50)},
        )
        return result.get("values", []) if result else []

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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/merge",
            json=payload,
        )
        if not result:
            raise BitbucketError(f"Failed to merge PR #{pr_id}")
        return result

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
            f"repositories/{self.workspace}/{repo_slug}/pipelines/",
            json=payload,
        )
        if not result:
            raise BitbucketError(f"Failed to trigger pipeline on {branch}")
        return result

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
        # Ensure UUID has braces
        if not pipeline_uuid.startswith("{"):
            pipeline_uuid = f"{{{pipeline_uuid}}}"

        return self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/pipelines/{pipeline_uuid}",
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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/pipelines/",
            params={"pagelen": min(limit, 100), "sort": "-created_on"},
        )
        return result.get("values", []) if result else []

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
        if not pipeline_uuid.startswith("{"):
            pipeline_uuid = f"{{{pipeline_uuid}}}"

        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/pipelines/{pipeline_uuid}/steps/",
        )
        return result.get("values", []) if result else []

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
        if not pipeline_uuid.startswith("{"):
            pipeline_uuid = f"{{{pipeline_uuid}}}"
        if not step_uuid.startswith("{"):
            step_uuid = f"{{{step_uuid}}}"

        # Logs endpoint returns plain text and may redirect
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            r = client.get(
                self._url(
                    f"repositories/{self.workspace}/{repo_slug}/pipelines/"
                    f"{pipeline_uuid}/steps/{step_uuid}/log"
                ),
                auth=self._get_auth(),
            )
            if r.status_code == 200:
                return r.text
            elif r.status_code == 404:
                return ""
            else:
                raise BitbucketError(f"Failed to get logs: {r.status_code}")

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
        if not pipeline_uuid.startswith("{"):
            pipeline_uuid = f"{{{pipeline_uuid}}}"

        result = self._request(
            "POST",
            f"repositories/{self.workspace}/{repo_slug}/pipelines/{pipeline_uuid}/stopPipeline",
        )
        # 204 returns {} which is a success
        if result is None:
            raise BitbucketError(f"Failed to stop pipeline {pipeline_uuid}")
        # Return updated pipeline state
        return self.get_pipeline(repo_slug, pipeline_uuid) or {"stopped": True}

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
        result = self._request(
            "GET",
            f"workspaces/{self.workspace}/projects",
            params={"pagelen": min(limit, 100)},
        )
        return result.get("values", []) if result else []

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

        result = self._request(
            "PUT",
            f"repositories/{self.workspace}/{repo_slug}",
            json=payload,
        )
        if not result:
            raise BitbucketError(f"Failed to update repository: {repo_slug}")
        return result

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
        params = {"pagelen": min(limit, 100)}
        if branch:
            params["include"] = branch
        if path:
            params["path"] = path

        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/commits",
            params=params,
        )
        return result.get("values", []) if result else []

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
        return self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/commit/{commit}",
        )

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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/diffstat/{base}..{head}",
        )
        return result

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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/commit/{commit}/statuses",
            params={"pagelen": min(limit, 100)},
        )
        return result.get("values", []) if result else []

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
            f"repositories/{self.workspace}/{repo_slug}/commit/{commit}/statuses/build",
            json=payload,
        )
        if not result:
            raise BitbucketError(f"Failed to create status for commit {commit}")
        return result

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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/comments",
            params={"pagelen": min(limit, 100)},
        )
        return result.get("values", []) if result else []

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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/comments",
            json=payload,
        )
        if not result:
            raise BitbucketError(f"Failed to add comment to PR #{pr_id}")
        return result

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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/approve",
        )
        if not result:
            raise BitbucketError(f"Failed to approve PR #{pr_id}")
        return result

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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/approve",
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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/request-changes",
        )
        if not result:
            raise BitbucketError(f"Failed to request changes on PR #{pr_id}")
        return result

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
            f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/decline",
        )
        if not result:
            raise BitbucketError(f"Failed to decline PR #{pr_id}")
        return result

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
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            r = client.get(
                self._url(
                    f"repositories/{self.workspace}/{repo_slug}/pullrequests/{pr_id}/diff"
                ),
                auth=self._get_auth(),
            )
            if r.status_code == 200:
                return r.text
            elif r.status_code == 404:
                return ""
            else:
                raise BitbucketError(f"Failed to get PR diff: {r.status_code}")

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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/environments",
            params={"pagelen": min(limit, 100)},
        )
        return result.get("values", []) if result else []

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
        if not environment_uuid.startswith("{"):
            environment_uuid = f"{{{environment_uuid}}}"

        return self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/environments/{environment_uuid}",
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
        if not environment_uuid.startswith("{"):
            environment_uuid = f"{{{environment_uuid}}}"

        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/deployments",
            params={
                "pagelen": min(limit, 100),
                "environment": environment_uuid,
                "sort": "-state.started_on",
            },
        )
        return result.get("values", []) if result else []

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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/hooks",
            params={"pagelen": min(limit, 100)},
        )
        return result.get("values", []) if result else []

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
            f"repositories/{self.workspace}/{repo_slug}/hooks",
            json=payload,
        )
        if not result:
            raise BitbucketError("Failed to create webhook")
        return result

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
        if not webhook_uid.startswith("{"):
            webhook_uid = f"{{{webhook_uid}}}"

        return self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/hooks/{webhook_uid}",
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
        if not webhook_uid.startswith("{"):
            webhook_uid = f"{{{webhook_uid}}}"

        self._request(
            "DELETE",
            f"repositories/{self.workspace}/{repo_slug}/hooks/{webhook_uid}",
        )
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
        result = self._request(
            "GET",
            f"repositories/{self.workspace}/{repo_slug}/refs/branches",
            params={"pagelen": min(limit, 100)},
        )
        return result.get("values", []) if result else []

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
            f"repositories/{self.workspace}/{repo_slug}/refs/branches/{branch_name}",
        )

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
