# AGENTS.md

MCP (Model Context Protocol) server for the Bitbucket Cloud API 2.0: repositories,
pull requests, pipelines, branches, commits, tags, deployments, webhooks, branch
restrictions, source browsing and permissions (58 tools, 4 prompts, 5 resources).
Published as `mcp-server-bitbucket` on npm (TypeScript) and PyPI (Python).

This repository is public (GitHub `JaviMaligno/mcp-server-bitbucket`). Keep
company-internal infrastructure details (hostnames, registries, clusters, secret
paths) and credentials out of committed files. `.env` is gitignored; document new
variables in `.env.example` with placeholder values.

## Layout

| Path | What it is |
|------|------------|
| `typescript/` | TypeScript implementation. Recommended/primary one: used for Smithery, the npm package and the Docker image. |
| `python/` | Python implementation (FastMCP). Same tool surface. Has its own detailed guide in `python/CLAUDE.md`. |
| `docs/` | `INSTALLATION.md` (token creation, client setup), `ROADMAP.md`. |
| `scripts/` | `evaluate_mcp.py`, `test_server_startup.py` (ad-hoc helpers). |
| `bitbucket-extension/` | Packaged `.mcpb` extension + `manifest.json`. |
| `smithery.yaml`, `glama.json`, `python/server.json` | Registry/marketplace metadata. |

TypeScript source (`typescript/src/`):
- `index.ts` - entry point; builds the MCP server and picks the transport
  (`MCP_TRANSPORT=http` or `--http` flag -> Streamable HTTP on `PORT`, default 3000; otherwise stdio).
- `tools/*.ts` - one file per domain (repositories, pull-requests, pipelines, ...), registered via `tools/index.ts`.
- `client.ts` - Bitbucket HTTP client (axios). `settings.ts` - env config and auth-mode resolution.
- `prompts.ts`, `resources.ts` - MCP prompts and `bitbucket://` resources.
- `auth.ts`, `oauth-proxy.ts` - optional OAuth protection of `/mcp` for remote deployments (see below).

Python source (`python/src/`): `server.py` (all tools), `bitbucket_client.py`,
`settings.py` (pydantic-settings), `formatter.py` (JSON/TOON output), `models.py`,
`http_server.py` (Streamable HTTP transport).

## Commands

TypeScript (run in `typescript/`):

```bash
npm install          # or npm ci
npm run build        # tsup -> dist/
npm run dev          # watch build
npm start            # node dist/index.js (stdio; MCP_TRANSPORT=http for HTTP)
npm test             # vitest run (tests in typescript/tests/)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/ (no ESLint config is committed yet, so this currently fails)
```

Python (run in `python/`):

```bash
uv sync
uv run python -m src.server            # stdio server
uv run python -m src.http_server       # HTTP server
uv run pytest                          # tests in python/tests/
```

## Configuration

Required: `BITBUCKET_WORKSPACE` plus credentials. Two auth modes, auto-detected:
- Basic: `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` (personal Atlassian API token, `ATATT...`).
- Bearer: `BITBUCKET_OAUTH_TOKEN` (workspace/project/repo access token, `ATCTT...`; returns 401 with Basic).
- `BITBUCKET_AUTH_TYPE=basic|bearer` always wins; otherwise bearer when `BITBUCKET_OAUTH_TOKEN`
  is set or no email is configured, else basic.

Optional: `API_TIMEOUT` (s, default 30), `MAX_RETRIES` (default 3, retries 429 with backoff),
`OUTPUT_FORMAT=json|toon`.

Remote OAuth gate (TypeScript only): `MCP_OAUTH_ISSUER`, `MCP_OAUTH_AUDIENCE`,
`MCP_OAUTH_JWKS_URI`, `MCP_OAUTH_REQUIRED_SCOPE`, `MCP_PUBLIC_URL` (plus Entra-specific
knobs such as `MCP_OAUTH_RESOURCE`, `MCP_OAUTH_AS_METADATA`, `MCP_OAUTH_SCOPES_SUPPORTED`,
`MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_UPSTREAM_SCOPE`, `MCP_OAUTH_REDIRECT_ALLOWLIST`; all
documented in the header comments of `auth.ts` and `oauth-proxy.ts`). Off unless both
issuer and audience are set. When on, `/mcp` requires a valid JWT, `/health` stays
open, and the server acts as a thin authorization-server proxy in front of the real
issuer (needed for Microsoft Entra ID; rationale in `oauth-proxy.ts` header). It
controls who may use the server; Bitbucket calls still use the server's own credential.

## Adding a tool

Keep both implementations in parity when feasible:
- TypeScript: add the API call in `client.ts`, the tool in the matching `tools/<domain>.ts`.
- Python: add the method to `BitbucketClient` (`bitbucket_client.py`), the `@mcp.tool()` wrapper in `server.py`.
The HTTP transports expose new tools automatically. Update the tool tables in `README.md`.

## CI, release and deploy

- GitHub Actions (`.github/workflows/ci.yml`): on push/PR to `main`, Python tests
  (`uv run pytest --cov`) and TypeScript build + tests (TS tests are `continue-on-error`).
  On `v*` tags it builds and publishes both packages (PyPI trusted publishing, npm).
- The npm (`typescript/package.json`) and PyPI (`python/pyproject.toml`) versions are
  independent; bump the relevant one before tagging.
- `bitbucket-pipelines.yml` (root) only builds and publishes the container image from
  `typescript/Dockerfile` (context `typescript/`) via a shared pipeline template, on
  pushes to `main` and on tags. Tests are not run there. `python/bitbucket-pipelines.yml`
  is a separate Python test pipeline.
- The Docker image defaults to `MCP_TRANSPORT=http`, `PORT=3000`, non-root user.

## Gotchas

- The repo has two remotes (GitHub `origin` and a Bitbucket mirror); public releases come from GitHub.
- Python has no OAuth gate; remote deployments use the TypeScript image.
- Tool counts in README/`server.json` are hand-maintained; keep them in sync when adding tools.
