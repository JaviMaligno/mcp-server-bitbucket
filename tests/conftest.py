"""Pytest fixtures for bitbucket-mcp tests."""

import os

import pytest
import respx
from httpx import Response


@pytest.fixture(autouse=True)
def set_test_env_vars(monkeypatch):
    """Set required environment variables for all tests."""
    monkeypatch.setenv("BITBUCKET_WORKSPACE", "test-workspace")
    monkeypatch.setenv("BITBUCKET_EMAIL", "test@example.com")
    monkeypatch.setenv("BITBUCKET_API_TOKEN", "test-token-12345")
    # Clear settings cache to pick up new env vars
    from src.settings import clear_settings_cache
    clear_settings_cache()
    yield
    clear_settings_cache()


@pytest.fixture
def mock_bitbucket_api():
    """Mock Bitbucket API responses using respx."""
    with respx.mock(base_url="https://api.bitbucket.org/2.0") as respx_mock:
        yield respx_mock


@pytest.fixture
def sample_repository():
    """Sample repository response data."""
    return {
        "name": "test-repo",
        "full_name": "workspace/test-repo",
        "description": "A test repository",
        "is_private": True,
        "created_on": "2024-01-01T00:00:00Z",
        "updated_on": "2024-01-02T00:00:00Z",
        "mainbranch": {"name": "main"},
        "project": {"key": "TEST"},
        "links": {
            "html": {"href": "https://bitbucket.org/workspace/test-repo"},
            "clone": [
                {"name": "https", "href": "https://bitbucket.org/workspace/test-repo.git"},
                {"name": "ssh", "href": "git@bitbucket.org:workspace/test-repo.git"},
            ],
        },
    }


@pytest.fixture
def sample_pipeline():
    """Sample pipeline response data."""
    return {
        "uuid": "{12345678-1234-1234-1234-123456789012}",
        "build_number": 42,
        "state": {"name": "COMPLETED", "result": {"name": "SUCCESSFUL"}},
        "target": {"ref_name": "main"},
        "created_on": "2024-01-01T00:00:00Z",
        "completed_on": "2024-01-01T00:05:00Z",
        "duration_in_seconds": 300,
    }


@pytest.fixture
def sample_commit():
    """Sample commit response data."""
    return {
        "hash": "abc123def456abc123def456abc123def456abc1",
        "message": "feat: add new feature\n\nDetailed description here",
        "author": {
            "raw": "Test User <test@example.com>",
            "user": {"display_name": "Test User"},
        },
        "date": "2024-01-01T00:00:00Z",
        "parents": [{"hash": "parent123parent123parent123parent123pare"}],
    }


@pytest.fixture
def sample_branch():
    """Sample branch response data."""
    return {
        "name": "main",
        "target": {
            "hash": "abc123def456abc123def456abc123def456abc1",
            "message": "Latest commit message\nWith multiple lines",
            "date": "2024-01-01T00:00:00Z",
        },
    }


@pytest.fixture
def paginated_response():
    """Factory for paginated API responses."""
    def _make_response(values, page=1, size=10):
        return {
            "values": values,
            "page": page,
            "pagelen": size,
            "size": len(values),
        }
    return _make_response
