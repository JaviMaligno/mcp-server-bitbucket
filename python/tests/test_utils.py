"""Tests for src/utils.py."""

from src.bitbucket_client import BitbucketError
from src.utils import (
    ensure_uuid_braces,
    first_line,
    handle_bitbucket_error,
    not_found_response,
    sanitize_search_term,
    truncate_hash,
)


class TestEnsureUuidBraces:
    """Tests for ensure_uuid_braces function."""

    def test_adds_braces_when_missing(self):
        """UUID without braces should get braces added."""
        uuid = "12345678-1234-1234-1234-123456789012"
        result = ensure_uuid_braces(uuid)
        assert result == "{12345678-1234-1234-1234-123456789012}"

    def test_preserves_existing_braces(self):
        """UUID with braces should remain unchanged."""
        uuid = "{12345678-1234-1234-1234-123456789012}"
        result = ensure_uuid_braces(uuid)
        assert result == "{12345678-1234-1234-1234-123456789012}"

    def test_handles_empty_string(self):
        """Empty string should get braces."""
        result = ensure_uuid_braces("")
        assert result == "{}"

    def test_handles_short_uuid(self):
        """Short strings should still get braces."""
        result = ensure_uuid_braces("abc123")
        assert result == "{abc123}"


class TestTruncateHash:
    """Tests for truncate_hash function."""

    def test_truncates_long_hash(self):
        """Long hash should be truncated to 12 chars by default."""
        hash_str = "abc123def456abc123def456abc123def456"
        result = truncate_hash(hash_str)
        assert result == "abc123def456"
        assert len(result) == 12

    def test_preserves_short_hash(self):
        """Hash shorter than limit should remain unchanged."""
        hash_str = "abc123"
        result = truncate_hash(hash_str)
        assert result == "abc123"

    def test_handles_none(self):
        """None should return empty string."""
        result = truncate_hash(None)
        assert result == ""

    def test_custom_length(self):
        """Should respect custom length parameter."""
        hash_str = "abc123def456"
        result = truncate_hash(hash_str, length=7)
        assert result == "abc123d"


class TestFirstLine:
    """Tests for first_line function."""

    def test_extracts_first_line_from_multiline(self):
        """Should return first line from multiline text."""
        text = "First line\nSecond line\nThird line"
        result = first_line(text)
        assert result == "First line"

    def test_returns_single_line_unchanged(self):
        """Single line text should be returned unchanged."""
        text = "Just one line"
        result = first_line(text)
        assert result == "Just one line"

    def test_handles_none(self):
        """None should return empty string."""
        result = first_line(None)
        assert result == ""

    def test_handles_empty_string(self):
        """Empty string should return empty string."""
        result = first_line("")
        assert result == ""

    def test_handles_only_newlines(self):
        """Text with only newlines should return empty string."""
        text = "\n\n\n"
        result = first_line(text)
        assert result == ""


class TestHandleBitbucketError:
    """Tests for handle_bitbucket_error decorator."""

    def test_returns_result_on_success(self):
        """Should return function result when no exception."""
        @handle_bitbucket_error
        def successful_func():
            return {"success": True, "data": "test"}

        result = successful_func()
        assert result == {"success": True, "data": "test"}

    def test_catches_bitbucket_error(self):
        """Should catch BitbucketError and return error dict."""
        @handle_bitbucket_error
        def failing_func():
            raise BitbucketError("Something went wrong")

        result = failing_func()
        assert result == {"success": False, "error": "Something went wrong"}

    def test_preserves_function_name(self):
        """Decorator should preserve wrapped function name."""
        @handle_bitbucket_error
        def my_function():
            return {"success": True}

        assert my_function.__name__ == "my_function"

    def test_passes_args_and_kwargs(self):
        """Should pass arguments to wrapped function."""
        @handle_bitbucket_error
        def func_with_args(a, b, c=None):
            return {"a": a, "b": b, "c": c}

        result = func_with_args(1, 2, c=3)
        assert result == {"a": 1, "b": 2, "c": 3}


class TestNotFoundResponse:
    """Tests for not_found_response function."""

    def test_formats_message_with_repository(self):
        """Should format message for repository."""
        result = not_found_response("Repository", "my-repo")
        assert result == {"error": "Repository 'my-repo' not found"}

    def test_formats_message_with_pr(self):
        """Should format message for PR."""
        result = not_found_response("PR", "#123")
        assert result == {"error": "PR '#123' not found"}

    def test_formats_message_with_pipeline(self):
        """Should format message for pipeline."""
        result = not_found_response("Pipeline", "{uuid}")
        assert result == {"error": "Pipeline '{uuid}' not found"}

    def test_formats_message_with_commit(self):
        """Should format message for commit."""
        result = not_found_response("Commit", "abc123")
        assert result == {"error": "Commit 'abc123' not found"}


class TestSanitizeSearchTerm:
    """Tests for sanitize_search_term function (BQL injection prevention)."""

    def test_allows_normal_search_term(self):
        """Normal search terms should pass through unchanged."""
        result = sanitize_search_term("my-repo")
        assert result == "my-repo"

    def test_allows_alphanumeric_with_dashes(self):
        """Alphanumeric terms with dashes should be unchanged."""
        result = sanitize_search_term("my-test-repo-123")
        assert result == "my-test-repo-123"

    def test_removes_double_quotes(self):
        """Double quotes should be removed to prevent BQL injection."""
        result = sanitize_search_term('" OR is_private=false OR "')
        assert result == " OR is_private=false OR "
        assert '"' not in result

    def test_removes_backslashes(self):
        """Backslashes should be removed to prevent escape sequences."""
        result = sanitize_search_term('test\\ninjection')
        assert result == "testninjection"
        assert '\\' not in result

    def test_handles_complex_injection_attempt(self):
        """Complex injection attempts should be sanitized."""
        malicious = 'test" AND name~"admin'
        result = sanitize_search_term(malicious)
        assert result == "test AND name~admin"
        assert '"' not in result

    def test_handles_empty_string(self):
        """Empty string should return empty string."""
        result = sanitize_search_term("")
        assert result == ""

    def test_preserves_spaces_and_underscores(self):
        """Spaces and underscores should be preserved."""
        result = sanitize_search_term("my repo_name test")
        assert result == "my repo_name test"
