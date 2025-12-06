"""Bitbucket API client for MCP server.

Provides all Bitbucket API operations needed by the MCP tools:
- Repositories: get, create, delete, list
- Pull Requests: create, get, list, merge
- Pipelines: trigger, get, list, logs, stop
- Branches: list, get
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
            api_token: Bitbucket app password (default from env)
        """
        load_dotenv()

        self.workspace = workspace or os.getenv("BITBUCKET_WORKSPACE", "simplekyc")
        self.email = email or os.getenv("BITBUCKET_EMAIL")
        self.api_token = api_token or os.getenv("BITBUCKET_API_TOKEN")

        if not self.email or not self.api_token:
            raise BitbucketError(
                "Missing Bitbucket credentials. Set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN"
            )

    def _get_auth(self) -> tuple[str, str]:
        """Get auth tuple for requests."""
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
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List repositories in workspace.

        Args:
            project_key: Filter by project (optional)
            limit: Maximum results to return

        Returns:
            List of repository info dicts
        """
        params = {"pagelen": min(limit, 100)}
        if project_key:
            params["q"] = f'project.key="{project_key}"'

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
