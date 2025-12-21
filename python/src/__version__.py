"""Version information for mcp-server-bitbucket.

This module provides a single source of truth for the package version.
The version is read dynamically from pyproject.toml at import time,
with a fallback for when the package is installed.
"""

try:
    from importlib.metadata import version, PackageNotFoundError

    try:
        __version__ = version("mcp-server-bitbucket")
    except PackageNotFoundError:
        # Package not installed, read from pyproject.toml
        __version__ = "0.0.0-dev"
except ImportError:
    # Python < 3.8
    __version__ = "0.0.0-dev"
