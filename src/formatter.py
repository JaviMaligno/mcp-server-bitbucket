"""Output formatter module for MCP responses.

Supports JSON (default) and TOON (Token-Oriented Object Notation) formats.
TOON provides ~30-40% token savings for LLM consumption.

Configuration:
    Environment variable: OUTPUT_FORMAT=json|toon (default: json)
    CLI flag: --output-format=json|toon

Usage:
    from src.formatter import format_output, formatted

    # Direct formatting
    result = format_output({"key": "value"})

    # Decorator for tool functions
    @formatted
    def my_tool() -> dict:
        return {"data": "value"}
"""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, TypeVar
from src.settings import clear_settings_cache, get_settings

# Lazy import to avoid import errors if toon-llm not installed
_toon_encode = None

F = TypeVar("F", bound=Callable[..., Any])


def _get_toon_encoder():
    """Lazy load TOON encoder."""
    global _toon_encode
    if _toon_encode is None:
        try:
            from toon import encode as toon_encode

            _toon_encode = toon_encode
        except ImportError:
            from toon_llm import encode as toon_encode

            _toon_encode = toon_encode
    return _toon_encode


class OutputFormat:
    """Output format configuration."""

    JSON = "json"
    TOON = "toon"

    _current: str | None = None

    @classmethod
    def get(cls) -> str:
        """Get current output format from settings or cache."""
        if cls._current is None:
            fmt = get_settings().output_format.lower()
            cls._current = fmt if fmt in (cls.JSON, cls.TOON) else cls.JSON
        return cls._current

    @classmethod
    def set(cls, fmt: str) -> None:
        """Set output format programmatically (useful for testing)."""
        if fmt.lower() in (cls.JSON, cls.TOON):
            cls._current = fmt.lower()

    @classmethod
    def reset(cls) -> None:
        """Reset to read from settings again."""
        cls._current = None
        clear_settings_cache()

    @classmethod
    def is_toon(cls) -> bool:
        """Check if TOON format is enabled."""
        return cls.get() == cls.TOON


def format_output(data: Any) -> Any:
    """Format data for MCP tool response.

    Args:
        data: Dict or list to format

    Returns:
        - If JSON format: returns data unchanged (dict/list)
        - If TOON format: returns TOON-encoded string
    """
    if not OutputFormat.is_toon():
        return data

    # TOON format
    encoder = _get_toon_encoder()
    return encoder(data)


def formatted(func: F) -> F:
    """Decorator to apply output formatting to tool return values.

    Usage:
        @formatted
        @mcp.tool()
        def my_tool():
            return {"data": "value"}

    Or with other decorators:
        @mcp.tool()
        @formatted
        def my_tool():
            return {"data": "value"}
    """

    @wraps(func)
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        return format_output(result)

    return wrapper  # type: ignore
