"""Tests for authentication mode resolution (basic vs bearer).

Atlassian API tokens (ATATT...) authenticate with Basic auth as `email:token`.
Workspace/project/repository access tokens (ATCTT...) only authenticate with
`Authorization: Bearer <token>` - Basic auth returns 401 for them.
"""

import base64

import pytest
import respx
from httpx import Response
from pydantic import ValidationError

from src.bitbucket_client import BitbucketClient
from src.settings import clear_settings_cache, get_settings


@pytest.fixture
def env(monkeypatch):
    """Helper to set/clear Bitbucket env vars and reset the settings cache."""

    def _set(**values):
        for key in (
            "BITBUCKET_WORKSPACE",
            "BITBUCKET_EMAIL",
            "BITBUCKET_API_TOKEN",
            "BITBUCKET_OAUTH_TOKEN",
            "BITBUCKET_AUTH_TYPE",
        ):
            monkeypatch.delenv(key, raising=False)
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        clear_settings_cache()
        return get_settings()

    return _set


class TestAuthTypeResolution:
    """Tests for how Settings resolves the auth mode."""

    def test_email_and_api_token_default_to_basic(self, env):
        """Existing setups (email + API token) keep using Basic auth."""
        settings = env(
            BITBUCKET_WORKSPACE="test-workspace",
            BITBUCKET_EMAIL="test@example.com",
            BITBUCKET_API_TOKEN="ATATT-personal",
        )

        assert settings.bitbucket_auth_type == "basic"
        assert settings.bitbucket_api_token.get_secret_value() == "ATATT-personal"

    def test_oauth_token_switches_to_bearer(self, env):
        """A configured BITBUCKET_OAUTH_TOKEN selects bearer and wins over the API token."""
        settings = env(
            BITBUCKET_WORKSPACE="test-workspace",
            BITBUCKET_EMAIL="test@example.com",
            BITBUCKET_API_TOKEN="ATATT-personal",
            BITBUCKET_OAUTH_TOKEN="ATCTT-workspace",
        )

        assert settings.bitbucket_auth_type == "bearer"
        assert settings.bitbucket_api_token.get_secret_value() == "ATCTT-workspace"

    def test_token_without_email_uses_bearer(self, env):
        """An access token with no email has no account to pair with -> bearer."""
        settings = env(
            BITBUCKET_WORKSPACE="test-workspace",
            BITBUCKET_API_TOKEN="ATCTT-workspace",
        )

        assert settings.bitbucket_auth_type == "bearer"
        assert settings.bitbucket_api_token.get_secret_value() == "ATCTT-workspace"

    def test_explicit_auth_type_wins(self, env):
        """BITBUCKET_AUTH_TYPE overrides auto-detection."""
        settings = env(
            BITBUCKET_WORKSPACE="test-workspace",
            BITBUCKET_EMAIL="test@example.com",
            BITBUCKET_API_TOKEN="ATCTT-workspace",
            BITBUCKET_AUTH_TYPE="Bearer",
        )

        assert settings.bitbucket_auth_type == "bearer"

    def test_basic_without_email_is_rejected(self, env):
        """Basic auth without an email would 401 at runtime - fail fast instead."""
        with pytest.raises(ValidationError, match="BITBUCKET_EMAIL is required"):
            env(
                BITBUCKET_WORKSPACE="test-workspace",
                BITBUCKET_API_TOKEN="ATATT-personal",
                BITBUCKET_AUTH_TYPE="basic",
            )

    def test_missing_token_is_rejected(self, env):
        """Neither token configured -> configuration error."""
        with pytest.raises(ValidationError, match="BITBUCKET_API_TOKEN"):
            env(
                BITBUCKET_WORKSPACE="test-workspace",
                BITBUCKET_EMAIL="test@example.com",
            )


class TestClientAuthHeaders:
    """Tests for the headers the HTTP client actually sends."""

    @respx.mock
    def test_bearer_sends_authorization_header(self):
        """Bearer mode sends `Authorization: Bearer <token>` and no Basic auth."""
        route = respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace"
        ).mock(return_value=Response(200, json={"values": [], "pagelen": 10}))

        client = BitbucketClient(
            workspace="test-workspace",
            api_token="ATCTT-workspace",
            auth_type="bearer",
        )
        client.list_repositories(limit=10)

        assert route.calls[0].request.headers["authorization"] == "Bearer ATCTT-workspace"

    @respx.mock
    def test_basic_still_sends_basic_auth(self):
        """Basic mode keeps the email:token pair (personal API tokens)."""
        route = respx.get(
            "https://api.bitbucket.org/2.0/repositories/test-workspace"
        ).mock(return_value=Response(200, json={"values": [], "pagelen": 10}))

        client = BitbucketClient(
            workspace="test-workspace",
            email="test@example.com",
            api_token="ATATT-personal",
            auth_type="basic",
        )
        client.list_repositories(limit=10)

        expected = base64.b64encode(b"test@example.com:ATATT-personal").decode()
        assert route.calls[0].request.headers["authorization"] == f"Basic {expected}"
