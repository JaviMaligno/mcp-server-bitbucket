"""Tests for output formatter module."""

import os

import pytest

from src.formatter import OutputFormat, format_output, formatted


class TestOutputFormat:
    """Tests for OutputFormat configuration class."""

    def setup_method(self):
        """Reset OutputFormat before each test."""
        OutputFormat.reset()
        # Clear environment variable if set
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def teardown_method(self):
        """Clean up after each test."""
        OutputFormat.reset()
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def test_default_is_json(self):
        """Default format should be JSON."""
        assert OutputFormat.get() == "json"
        assert not OutputFormat.is_toon()

    def test_set_toon_format(self):
        """Can set format to TOON."""
        OutputFormat.set("toon")
        assert OutputFormat.get() == "toon"
        assert OutputFormat.is_toon()

    def test_set_json_format(self):
        """Can explicitly set format to JSON."""
        OutputFormat.set("toon")
        OutputFormat.set("json")
        assert OutputFormat.get() == "json"

    def test_case_insensitive(self):
        """Format setting is case-insensitive."""
        OutputFormat.set("TOON")
        assert OutputFormat.get() == "toon"
        OutputFormat.set("JSON")
        assert OutputFormat.get() == "json"

    def test_invalid_format_ignored(self):
        """Invalid format values are ignored."""
        OutputFormat.set("toon")
        OutputFormat.set("invalid")
        # Should remain toon since invalid was ignored
        assert OutputFormat.get() == "toon"

    def test_reads_from_environment(self):
        """Reads OUTPUT_FORMAT from environment."""
        os.environ["OUTPUT_FORMAT"] = "toon"
        OutputFormat.reset()
        assert OutputFormat.get() == "toon"

    def test_environment_invalid_raises_validation_error(self):
        """Invalid environment value raises validation error for security."""
        import pytest
        from pydantic import ValidationError

        os.environ["OUTPUT_FORMAT"] = "invalid"
        OutputFormat.reset()
        with pytest.raises(ValidationError):
            OutputFormat.get()

    def test_reset_clears_cache(self):
        """Reset clears cached value."""
        OutputFormat.set("toon")
        assert OutputFormat.get() == "toon"
        OutputFormat.reset()
        # After reset, should read from environment (which is unset = json)
        assert OutputFormat.get() == "json"


class TestFormatOutput:
    """Tests for format_output function."""

    def setup_method(self):
        OutputFormat.reset()
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def teardown_method(self):
        OutputFormat.reset()
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def test_json_format_returns_unchanged(self):
        """JSON format returns data unchanged."""
        data = {"name": "test", "value": 123}
        result = format_output(data)
        assert result == data
        assert isinstance(result, dict)

    def test_json_format_list_unchanged(self):
        """JSON format returns list unchanged."""
        data = [{"id": 1}, {"id": 2}]
        result = format_output(data)
        assert result == data
        assert isinstance(result, list)

    def test_toon_format_returns_string(self):
        """TOON format returns encoded string."""
        OutputFormat.set("toon")
        data = {"name": "test", "value": 123}
        result = format_output(data)
        assert isinstance(result, str)
        assert "name:" in result or "name" in result

    def test_toon_format_list(self):
        """TOON format encodes list of dicts."""
        OutputFormat.set("toon")
        data = [
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
        ]
        result = format_output(data)
        assert isinstance(result, str)
        # TOON tabular format should have header with field names
        assert "id" in result
        assert "name" in result
        assert "Alice" in result
        assert "Bob" in result


class TestFormattedDecorator:
    """Tests for @formatted decorator."""

    def setup_method(self):
        OutputFormat.reset()
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def teardown_method(self):
        OutputFormat.reset()
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def test_json_format_unchanged(self):
        """Decorated function returns dict in JSON mode."""

        @formatted
        def get_data():
            return {"key": "value"}

        result = get_data()
        assert result == {"key": "value"}

    def test_toon_format_encoded(self):
        """Decorated function returns TOON string in TOON mode."""
        OutputFormat.set("toon")

        @formatted
        def get_data():
            return {"key": "value"}

        result = get_data()
        assert isinstance(result, str)
        assert "key" in result
        assert "value" in result

    def test_preserves_function_name(self):
        """Decorator preserves function name."""

        @formatted
        def my_function():
            return {}

        assert my_function.__name__ == "my_function"

    def test_preserves_docstring(self):
        """Decorator preserves docstring."""

        @formatted
        def my_function():
            """This is my docstring."""
            return {}

        assert my_function.__doc__ == """This is my docstring."""

    def test_works_with_args_kwargs(self):
        """Decorator works with arguments."""

        @formatted
        def get_user(user_id: int, include_email: bool = False):
            return {"id": user_id, "include_email": include_email}

        result = get_user(123, include_email=True)
        assert result == {"id": 123, "include_email": True}

    def test_works_with_other_decorators(self):
        """Decorator works when combined with other decorators."""

        def logging_decorator(func):
            def wrapper(*args, **kwargs):
                return func(*args, **kwargs)

            return wrapper

        @logging_decorator
        @formatted
        def get_data():
            return {"status": "ok"}

        result = get_data()
        # In JSON mode, should still work
        assert result == {"status": "ok"}


class TestToonIntegration:
    """Integration tests for TOON encoding."""

    def setup_method(self):
        OutputFormat.reset()

    def teardown_method(self):
        OutputFormat.reset()
        if "OUTPUT_FORMAT" in os.environ:
            del os.environ["OUTPUT_FORMAT"]

    def test_realistic_commits_response(self):
        """Test with realistic commits data structure."""
        OutputFormat.set("toon")

        commits = [
            {
                "hash": "abc123def456",
                "message": "feat: add auth",
                "author": "John <john@ex.com>",
                "date": "2025-01-15T14:30",
            },
            {
                "hash": "def789abc012",
                "message": "fix: login bug",
                "author": "Jane <jane@ex.com>",
                "date": "2025-01-14T10:15",
            },
        ]

        result = format_output({"commits": commits})
        assert isinstance(result, str)
        # Should contain the data
        assert "abc123def456" in result
        assert "feat: add auth" in result

    def test_realistic_tags_response(self):
        """Test with realistic tags data structure."""
        OutputFormat.set("toon")

        tags = [
            {"name": "v1.0.0", "target": "abc123def456"},
            {"name": "v0.9.0", "target": "def789abc012"},
        ]

        result = format_output({"tags": tags})
        assert isinstance(result, str)
        assert "v1.0.0" in result
        assert "v0.9.0" in result
