"""Application settings using pydantic-settings.

Centralizes all environment variable configuration for the MCP server.
Supports .env files and environment variables.

Usage:
    from src.settings import settings

    workspace = settings.bitbucket_workspace
    email = settings.bitbucket_email
"""

from enum import Enum
from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ==================== ENUMS FOR INPUT VALIDATION ====================


class PRState(str, Enum):
    """Valid states for pull requests."""

    OPEN = "OPEN"
    MERGED = "MERGED"
    DECLINED = "DECLINED"
    SUPERSEDED = "SUPERSEDED"


class MergeStrategy(str, Enum):
    """Valid merge strategies for pull requests."""

    MERGE_COMMIT = "merge_commit"
    SQUASH = "squash"
    FAST_FORWARD = "fast_forward"


class OutputFormat(str, Enum):
    """Valid output formats."""

    JSON = "json"
    TOON = "toon"


class CommitStatusState(str, Enum):
    """Valid states for commit statuses."""

    SUCCESSFUL = "SUCCESSFUL"
    FAILED = "FAILED"
    INPROGRESS = "INPROGRESS"
    STOPPED = "STOPPED"


# ==================== SETTINGS ====================


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    Environment Variables:
        BITBUCKET_WORKSPACE: Bitbucket workspace slug
        BITBUCKET_EMAIL: Account email for Basic Auth
        BITBUCKET_API_TOKEN: Repository access token
        OUTPUT_FORMAT: Output format (json or toon)
        API_TIMEOUT: Default API request timeout in seconds (default: 30)
        MAX_RETRIES: Maximum retry attempts for rate-limited requests (default: 3)
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Bitbucket API credentials - no default for workspace (must be configured)
    bitbucket_workspace: str
    bitbucket_email: str
    bitbucket_api_token: SecretStr

    # Output format configuration with validation
    output_format: Literal["json", "toon"] = "json"

    # API behavior configuration
    api_timeout: int = 30  # seconds
    max_retries: int = 3

    @field_validator("output_format", mode="before")
    @classmethod
    def lowercase_output_format(cls, v: str) -> str:
        """Normalize output format to lowercase."""
        return v.lower() if isinstance(v, str) else v

    @field_validator("api_timeout", mode="after")
    @classmethod
    def validate_timeout(cls, v: int) -> int:
        """Ensure timeout is reasonable (1-300 seconds)."""
        return max(1, min(v, 300))

    @field_validator("max_retries", mode="after")
    @classmethod
    def validate_retries(cls, v: int) -> int:
        """Ensure retries is reasonable (0-10)."""
        return max(0, min(v, 10))


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Returns:
        Settings instance loaded from environment
    """
    return Settings()


def clear_settings_cache() -> None:
    """Clear the settings cache.

    Useful for testing when environment variables change.
    """
    get_settings.cache_clear()
