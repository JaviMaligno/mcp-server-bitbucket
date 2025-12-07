"""Utility functions for bitbucket-mcp."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, Optional


def ensure_uuid_braces(uuid: str) -> str:
    """Ensure a UUID has braces format {uuid}.

    Bitbucket API expects UUIDs in the format {uuid} for certain endpoints.
    This function normalizes UUIDs to always have braces.

    Args:
        uuid: UUID string, with or without braces

    Returns:
        UUID string with braces

    Examples:
        >>> ensure_uuid_braces("12345678-1234-1234-1234-123456789012")
        '{12345678-1234-1234-1234-123456789012}'
        >>> ensure_uuid_braces("{12345678-1234-1234-1234-123456789012}")
        '{12345678-1234-1234-1234-123456789012}'
    """
    if not uuid.startswith("{"):
        return f"{{{uuid}}}"
    return uuid


def truncate_hash(hash_str: Optional[str], length: int = 12) -> str:
    """Truncate a hash to specified length.

    Args:
        hash_str: Hash string to truncate (can be None)
        length: Maximum length (default: 12)

    Returns:
        Truncated hash string, or empty string if input is None

    Examples:
        >>> truncate_hash("abc123def456abc123def456")
        'abc123def456'
        >>> truncate_hash(None)
        ''
    """
    return (hash_str or "")[:length]


def first_line(text: Optional[str]) -> str:
    """Extract the first line from text.

    Args:
        text: Text string (can be None or multiline)

    Returns:
        First line of text, or empty string if input is None

    Examples:
        >>> first_line("First line\\nSecond line")
        'First line'
        >>> first_line("Single line")
        'Single line'
        >>> first_line(None)
        ''
    """
    return (text or "").split("\n")[0]


def handle_bitbucket_error(func: Callable[..., dict[str, Any]]) -> Callable[..., dict[str, Any]]:
    """Decorator to handle BitbucketError consistently.

    Wraps a function to catch BitbucketError exceptions and return
    a standardized error response instead of raising.

    Args:
        func: Function that may raise BitbucketError

    Returns:
        Wrapped function that returns {"success": False, "error": str} on error

    Example:
        @handle_bitbucket_error
        def create_something():
            result = client.create(...)
            return {"success": True, "data": result}
    """
    # Import here to avoid circular dependency
    from src.bitbucket_client import BitbucketError

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return func(*args, **kwargs)
        except BitbucketError as e:
            return {"success": False, "error": str(e)}

    return wrapper


def not_found_response(resource: str, identifier: str) -> dict[str, Any]:
    """Standard response for not-found resources.

    Args:
        resource: Resource type name (e.g., "Repository", "PR")
        identifier: Resource identifier (e.g., repo_slug, pr_id)

    Returns:
        Dict with error message

    Example:
        >>> not_found_response("Repository", "my-repo")
        {'error': "Repository 'my-repo' not found"}
    """
    return {"error": f"{resource} '{identifier}' not found"}


def sanitize_search_term(search: str) -> str:
    """Sanitize a search term to prevent BQL injection.

    Removes or escapes characters that could be used to inject
    Bitbucket Query Language operators.

    Args:
        search: User-provided search term

    Returns:
        Sanitized search term safe for BQL interpolation

    Examples:
        >>> sanitize_search_term("my-repo")
        'my-repo'
        >>> sanitize_search_term('" OR is_private=false OR "')
        ' OR is_private=false OR '
        >>> sanitize_search_term('test" AND name~"')
        'test AND name'
    """
    # Remove double quotes which are used to delimit strings in BQL
    sanitized = search.replace('"', "")
    # Remove backslashes which could be used for escaping
    sanitized = sanitized.replace("\\", "")
    return sanitized
