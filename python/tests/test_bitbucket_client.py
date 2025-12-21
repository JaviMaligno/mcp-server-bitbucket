"""Tests for src/bitbucket_client.py."""

import pytest
import respx
from httpx import Response

from src.bitbucket_client import BitbucketClient, BitbucketError


@pytest.fixture
def client():
    """Create a BitbucketClient with test credentials."""
    # Pass credentials directly to avoid .env interference
    return BitbucketClient(
        workspace="test-workspace",
        email="test@example.com",
        api_token="test-token",
    )


class TestListRepositories:
    """Tests for list_repositories method."""

    @respx.mock
    def test_returns_list_of_repos(self, client):
        """Should return list of repository dicts."""
        respx.get("https://api.bitbucket.org/2.0/repositories/test-workspace").mock(
            return_value=Response(200, json={
                "values": [
                    {"name": "repo1", "full_name": "test-workspace/repo1"},
                    {"name": "repo2", "full_name": "test-workspace/repo2"},
                ],
                "pagelen": 50,
            })
        )

        result = client.list_repositories(limit=50)

        assert len(result) == 2
        assert result[0]["name"] == "repo1"
        assert result[1]["name"] == "repo2"

    @respx.mock
    def test_returns_empty_list_on_no_results(self, client):
        """Should return empty list when no repos found."""
        respx.get("https://api.bitbucket.org/2.0/repositories/test-workspace").mock(
            return_value=Response(200, json={"values": [], "pagelen": 50})
        )

        result = client.list_repositories()

        assert result == []

    @respx.mock
    def test_handles_404(self, client):
        """Should return empty list on 404."""
        respx.get("https://api.bitbucket.org/2.0/repositories/test-workspace").mock(
            return_value=Response(404)
        )

        result = client.list_repositories()

        assert result == []


class TestListBranches:
    """Tests for list_branches method."""

    @respx.mock
    def test_returns_list_of_branches(self, client):
        """Should return list of branch dicts."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/refs/branches"
        ).mock(
            return_value=Response(200, json={
                "values": [
                    {"name": "main", "target": {"hash": "abc123"}},
                    {"name": "develop", "target": {"hash": "def456"}},
                ],
            })
        )

        result = client.list_branches("test-repo")

        assert len(result) == 2
        assert result[0]["name"] == "main"


class TestListPipelines:
    """Tests for list_pipelines method."""

    @respx.mock
    def test_returns_sorted_pipelines(self, client):
        """Should return pipelines sorted by created_on."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pipelines/"
        ).mock(
            return_value=Response(200, json={
                "values": [
                    {"uuid": "{uuid1}", "build_number": 2},
                    {"uuid": "{uuid2}", "build_number": 1},
                ],
            })
        )

        result = client.list_pipelines("test-repo", limit=10)

        assert len(result) == 2
        assert result[0]["build_number"] == 2


class TestGetPipeline:
    """Tests for get_pipeline method - verifies UUID normalization."""

    @respx.mock
    def test_normalizes_uuid_without_braces(self, client):
        """Should add braces to UUID if missing."""
        route = respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pipelines/{12345678-1234-1234-1234-123456789012}"
        ).mock(
            return_value=Response(200, json={"uuid": "{12345678-1234-1234-1234-123456789012}"})
        )

        # Call with UUID without braces
        result = client.get_pipeline("test-repo", "12345678-1234-1234-1234-123456789012")

        assert route.called
        assert result["uuid"] == "{12345678-1234-1234-1234-123456789012}"

    @respx.mock
    def test_preserves_uuid_with_braces(self, client):
        """Should preserve braces if already present."""
        route = respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pipelines/{12345678-1234-1234-1234-123456789012}"
        ).mock(
            return_value=Response(200, json={"uuid": "{12345678-1234-1234-1234-123456789012}"})
        )

        # Call with UUID with braces
        result = client.get_pipeline("test-repo", "{12345678-1234-1234-1234-123456789012}")

        assert route.called
        assert result is not None


class TestGetWebhook:
    """Tests for get_webhook method - verifies UUID normalization."""

    @respx.mock
    def test_normalizes_webhook_uid(self, client):
        """Should add braces to webhook UID if missing."""
        route = respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/hooks/{webhook-uid}"
        ).mock(
            return_value=Response(200, json={"uuid": "{webhook-uid}", "url": "https://example.com"})
        )

        result = client.get_webhook("test-repo", "webhook-uid")

        assert route.called
        assert result["uuid"] == "{webhook-uid}"


class TestRequestText:
    """Tests for _request_text helper method."""

    @respx.mock
    def test_returns_text_on_success(self, client):
        """Should return text content on 200 response."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/src/main/README.md"
        ).mock(
            return_value=Response(200, text="# Hello World\n\nThis is a README.")
        )

        result = client._request_text("repositories/test-workspace/test-repo/src/main/README.md")

        assert result == "# Hello World\n\nThis is a README."

    @respx.mock
    def test_returns_none_on_404(self, client):
        """Should return None on 404 response."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/src/main/missing.txt"
        ).mock(
            return_value=Response(404)
        )

        result = client._request_text("repositories/test-workspace/test-repo/src/main/missing.txt")

        assert result is None

    @respx.mock
    def test_raises_on_error(self, client):
        """Should raise BitbucketError on error responses."""
        from src.bitbucket_client import BitbucketError

        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/src/main/file.txt"
        ).mock(
            return_value=Response(500)
        )

        with pytest.raises(BitbucketError, match="Request failed: 500"):
            client._request_text("repositories/test-workspace/test-repo/src/main/file.txt")


class TestGetFileContent:
    """Tests for get_file_content method."""

    @respx.mock
    def test_returns_file_content(self, client):
        """Should return file content as string."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/src/main/src/main.py"
        ).mock(
            return_value=Response(200, text="print('hello')")
        )

        result = client.get_file_content("test-repo", "src/main.py")

        assert result == "print('hello')"

    @respx.mock
    def test_returns_none_when_not_found(self, client):
        """Should return None for non-existent files."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/src/main/missing.py"
        ).mock(
            return_value=Response(404)
        )

        result = client.get_file_content("test-repo", "missing.py")

        assert result is None


class TestGetPrDiff:
    """Tests for get_pr_diff method."""

    @respx.mock
    def test_returns_diff_content(self, client):
        """Should return diff as string."""
        diff_content = "diff --git a/file.py b/file.py\n+new line"
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pullrequests/123/diff"
        ).mock(
            return_value=Response(200, text=diff_content)
        )

        result = client.get_pr_diff("test-repo", 123)

        assert result == diff_content

    @respx.mock
    def test_returns_empty_on_404(self, client):
        """Should return empty string on 404."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pullrequests/999/diff"
        ).mock(
            return_value=Response(404)
        )

        result = client.get_pr_diff("test-repo", 999)

        assert result == ""


class TestGetPipelineLogs:
    """Tests for get_pipeline_logs method."""

    @respx.mock
    def test_returns_logs(self, client):
        """Should return log content as string."""
        log_content = "Step 1: Building...\nStep 2: Testing...\nDone!"
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pipelines/"
            "{pipeline-uuid}/steps/{step-uuid}/log"
        ).mock(
            return_value=Response(200, text=log_content)
        )

        result = client.get_pipeline_logs("test-repo", "pipeline-uuid", "step-uuid")

        assert result == log_content

    @respx.mock
    def test_returns_empty_on_404(self, client):
        """Should return empty string on 404."""
        respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/pipelines/"
            "{missing-uuid}/steps/{step-uuid}/log"
        ).mock(
            return_value=Response(404)
        )

        result = client.get_pipeline_logs("test-repo", "missing-uuid", "step-uuid")

        assert result == ""


class TestRequireResult:
    """Tests for _require_result helper method."""

    def test_returns_result_when_valid(self, client):
        """Should return the result when it's valid."""
        result = {"id": 1, "name": "test"}

        returned = client._require_result(result, "create something", "test-id")

        assert returned == result

    def test_raises_on_none(self, client):
        """Should raise BitbucketError when result is None."""
        from src.bitbucket_client import BitbucketError

        with pytest.raises(BitbucketError, match="Failed to create something: test-id"):
            client._require_result(None, "create something", "test-id")

    def test_raises_on_empty_dict(self, client):
        """Should raise BitbucketError when result is empty dict."""
        from src.bitbucket_client import BitbucketError

        with pytest.raises(BitbucketError, match="Failed to do action"):
            client._require_result({}, "do action")

    def test_error_message_without_identifier(self, client):
        """Should format error message correctly without identifier."""
        from src.bitbucket_client import BitbucketError

        with pytest.raises(BitbucketError) as exc_info:
            client._require_result(None, "create webhook")

        assert str(exc_info.value) == "Failed to create webhook"
        assert ": " not in str(exc_info.value)  # No colon when no identifier


class TestRepoPath:
    """Tests for _repo_path helper method."""

    def test_base_path(self, client):
        """Should return base repository path."""
        path = client._repo_path("my-repo")
        assert path == "repositories/test-workspace/my-repo"

    def test_with_single_part(self, client):
        """Should append single path part."""
        path = client._repo_path("my-repo", "pullrequests")
        assert path == "repositories/test-workspace/my-repo/pullrequests"

    def test_with_multiple_parts(self, client):
        """Should append multiple path parts."""
        path = client._repo_path("my-repo", "pullrequests", "123", "merge")
        assert path == "repositories/test-workspace/my-repo/pullrequests/123/merge"

    def test_with_pipelines_path(self, client):
        """Should work with pipeline paths."""
        path = client._repo_path("my-repo", "pipelines", "{uuid}", "steps", "{step-uuid}", "log")
        assert path == "repositories/test-workspace/my-repo/pipelines/{uuid}/steps/{step-uuid}/log"


class TestRateLimiting:
    """Tests for rate limiting and retry behavior."""

    @respx.mock
    def test_retries_on_429(self, client, mocker):
        """Should retry on 429 with exponential backoff."""
        # Mock time.sleep to avoid actual delays
        mocker.patch("src.bitbucket_client.time.sleep")

        # First two calls return 429, third returns 200
        route = respx.get("https://api.bitbucket.org/2.0/repositories/test-workspace").mock(
            side_effect=[
                Response(429, headers={"Retry-After": "1"}),
                Response(429),
                Response(200, json={"values": [{"name": "repo1"}]}),
            ]
        )

        result = client.list_repositories()

        assert len(result) == 1
        assert route.call_count == 3

    @respx.mock
    def test_raises_after_max_retries(self, client, mocker):
        """Should raise BitbucketError after max retries exhausted."""
        mocker.patch("src.bitbucket_client.time.sleep")

        # All calls return 429
        respx.get("https://api.bitbucket.org/2.0/repositories/test-workspace").mock(
            return_value=Response(429)
        )

        with pytest.raises(BitbucketError, match="Rate limited after"):
            client.list_repositories()

    @respx.mock
    def test_request_text_retries_on_429(self, client, mocker):
        """Should retry text requests on 429."""
        mocker.patch("src.bitbucket_client.time.sleep")

        route = respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace/test-repo/src/main/README.md"
        ).mock(
            side_effect=[
                Response(429),
                Response(200, text="# README"),
            ]
        )

        result = client._request_text("repositories/test-workspace/test-repo/src/main/README.md")

        assert result == "# README"
        assert route.call_count == 2
