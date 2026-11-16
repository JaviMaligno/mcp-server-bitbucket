# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The repository ships two packages with independent versions:

- **TypeScript**: `mcp-server-bitbucket` on npm (`typescript/package.json`).
- **Python**: `mcp-server-bitbucket` on PyPI (`python/pyproject.toml`).

A single `v*` git tag publishes both. Since `v0.11.0` the tag follows the
TypeScript version, and each section lists the Python version shipped with it.
Up to `v0.10.0` only the Python package existed. Entries before `v0.19.2`
were reconstructed from the git history.

## [0.19.2] - TypeScript 0.19.2 / Python 0.13.1

### Fixed

- `list_pipelines` failed with `Invalid pagination cursor for this endpoint`
  on repositories with more than one page of pipelines. Bitbucket returns the
  pipelines `next` link addressed by the workspace and repository UUIDs, and
  the cursor validator only accepted the slugs. It now also accepts a braced
  UUID in those two path segments. Every other segment must still match, and
  the host, scheme and credential checks are unchanged. In TypeScript this
  failed even with `limit: 1`. In Python it failed only when `limit` needed a
  second page. ([#13])
- `get_pipeline`, `get_pipeline_logs` and `stop_pipeline` now accept the build
  number (e.g. `"2256"`) as well as the pipeline UUID. Before, the number was
  wrapped in braces and the API answered `400`. `stop_pipeline` first resolves
  a build number to its UUID. ([#13])

### Changed

- CI publishes to npm only through Trusted Publishing (OIDC). The `NPM_TOKEN`
  fallback is gone.

## [0.19.1] - 2026-11-05 - TypeScript 0.19.1

### Fixed

- TypeScript: keep Basic credentials across Bitbucket redirects (e.g. pipeline
  step logs).
- npm publishing repaired: it now uses Trusted Publishing with provenance.
  PyPI uploads use `skip-existing`, so a tag cut for one package does not fail
  on the other.

## [0.19.0] - 2026-10-29 - TypeScript 0.19.0 / Python 0.13.0

### Added

- Resumable history (`cursor` / `has_more` / `next_cursor`) and resilient reads
  (bounded retries, `Retry-After` handling) in both implementations.
- Optional OAuth protection of the remote HTTP transport (TypeScript), with a
  thin authorization-server proxy for issuers such as Microsoft Entra ID:
  metadata, dynamic client registration and loopback redirects.
- `AGENTS.md` with shared agent instructions.

### Security

- Patched the MCP runtimes, bounded HTTP input size and tightened CI trust.

## [0.13.0] - 2026-08-18 - TypeScript 0.13.0 / Python 0.12.0

### Added

- Bearer authentication for workspace, project and repository access tokens.
- Streamable HTTP transport for the TypeScript server, and a packaged
  Bitbucket extension (`.mcpb`).
- Container image build for the TypeScript server.

## [0.12.0] - 2026-03-10 - TypeScript 0.12.0 / Python 0.11.0

### Added

- `get_pipeline_config` and `update_pipeline_config` tools.
- License, and metadata for the Glama registry.

## [0.11.0] - 2026-01-21 - TypeScript 0.11.0 / Python 0.11.0

### Added

- TypeScript implementation with the same tool surface. It is used for Smithery,
  npm and the Docker image.
- Custom pipelines, commit triggers and secured variables in `trigger_pipeline`.
- MCP Registry (`server.json`) and Smithery integration.

## [0.10.0] - 2025-12-15

### Changed

- HTTP server migrated to the MCP Streamable HTTP transport.

## [0.9.1] - 2025-12-08

### Changed

- Repository moved to GitHub, and the documentation now covers 0.9.0.

## [0.9.0] - 2025-12-08

### Added

- Pipeline variable tools, MCP resources for workspace browsing, and MCP
  prompts for common workflows.

## [0.8.2] - 2025-12-08

### Added

- Rate limiting, retry with backoff and configurable timeouts.

## [0.8.1] - 2025-12-07

### Added

- Input validation with enums and limit clamping.

## [0.8.0] - 2025-12-07

### Security

- Security hardening across the client and server.

## [0.7.1] - 2025-12-07

### Changed

- Configuration centralized with pydantic-settings.

## [0.7.0] - 2025-12-07

### Added

- Configurable TOON output format (`OUTPUT_FORMAT=toon`), which uses about
  30-40% fewer tokens.

## [0.6.1] - 2025-12-06

### Fixed

- Empty fields excluded from lightweight tags.

## [0.6.0] - 2025-12-06

### Changed

- Responses trimmed for token efficiency.

## [0.5.0] - 2025-12-06

### Changed

- Pydantic response models.

## [0.4.0] - 2025-12-06

### Added

- Test infrastructure.

## [0.3.1] - 2025-12-06

### Fixed

- `list_tags` handles `None` values.

## [0.3.0] - 2025-12-06

### Added

- 16 tools for tags, branch restrictions, source browsing and permissions.

## [0.2.0] - 2025-12-06

### Added

- 20 tools for commits, PR reviews, deployments and webhooks.

## [0.1.3] - [0.1.7] - 2025-12-06

### Added

- Initial releases: installation guide and repository search with fuzzy name
  matching.

[#13]: https://github.com/JaviMaligno/mcp-server-bitbucket/issues/13
[0.19.2]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.13.0...v0.19.0
[0.13.0]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/JaviMaligno/mcp-server-bitbucket/compare/v0.9.1...v0.10.0
