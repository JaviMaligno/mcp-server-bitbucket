"""Application settings using pydantic-settings.

Centralizes all environment variable configuration for the MCP server.
Supports .env files and environment variables.

Usage:
    from src.settings import settings

    workspace = settings.bitbucket_workspace
    email = settings.bitbucket_email
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    Environment Variables:
        BITBUCKET_WORKSPACE: Bitbucket workspace slug
        BITBUCKET_EMAIL: Account email for Basic Auth
        BITBUCKET_API_TOKEN: Repository access token
        OUTPUT_FORMAT: Output format (json or toon)
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Bitbucket API credentials
    bitbucket_workspace: str = "simplekyc"
    bitbucket_email: str
    bitbucket_api_token: str

    # Output format configuration
    output_format: str = "json"


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
