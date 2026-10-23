# Runtime and dependency security update

The Python image now builds this checkout with `uv sync --frozen --no-dev --no-editable` from `python/`; it no longer installs an older published release. Node images use 24.22.1 and Python images use 3.11.17, with uv 0.13.5. Rebuild and redeploy images to change a running service. No package release or deployment is performed by this change.

Node consumers need a patched supported runtime (22.23.4 or 24.22.1). Python supports 3.11 and newer; CI checks patched 3.11/3.12 where applicable. Existing tool names, credential modes, database aliases, and stdio entry points are preserved. Test/toolchain parents move together to Vitest 4 and Vite 8 rather than overriding incompatible nested majors.

Draft pull requests run lightweight checks; Ready enables full tests and Linux Docker distribution builds without publishing images. Local verification does not run a Docker daemon, live server, or real provider/database calls. The Linux image proof remains pending until that Ready CI job passes.

Bitbucket HTTP requests are authenticated before MCP body parsing. MCP, OAuth registration and OAuth token form bodies are limited to 100 KiB, including chunked requests. Oversized bodies receive 413; JSON-RPC batches and tool calls with more than 1000 aggregate input elements receive 400 before SDK validation. OAuth form bytes, redirects, issuer/audience checks and response passthrough are preserved. Python uses patched MCP 1.30 defaults for HTTP body and session bounds.

The build uses tsup 8.5.0 deliberately: its official esbuild range is ^0.25.0, allowing a fixed compatible 0.25 release. tsup 8.5.1 instead constrains the Windows dev-server vulnerability branch to ^0.27.0. No incompatible esbuild override is introduced; ESM and declarations are rebuilt and the stdio protocol is checked against the resulting executable.

Vite 8 additionally declares an optional esbuild ^0.27.0 || ^0.28.0 peer. The root dev dependency supplies corrected esbuild ^0.28.1 for that peer while tsup retains its own compatible ^0.25.0 dependency. Both ranges are respected; neither uses a forced out-of-range override.


## Reconcile the advanced default branch (23 October 2026)

Main aa6347d incorporated PR8's alternate-runtime and CA trust fixes after this
security branch was reviewed. A normal merge preserves that history and combines
its system-CA refresh, Node CA gate, Python alternate-pipeline directory/artifact
fixes and trust checks with the reviewed local-source Docker distribution and
SDK/runtime/lock updates. No application, tool, auth or provider behavior changes
are made by this reconciliation.

The Python lock remains the reviewed PR7 graph (including certifi2026.10.19,
which is also main's corrected certificate floor). Neither an old SDK graph nor
the published PyPI application replaces this checkout. uv0.13.5 is retained.
The Python image uses that pinned uv to hash-verify global pip26.2.2 before pip
execution; the alternate pipeline verifies the same wheel before executing it
through PYTHONPATH. Build/setup gates check nonempty trust stores and reject the
same compromised-CA fingerprint as incoming main, including pip/OS and app certifi.

GitHub PR Draft keeps light validation; Ready runs the full existing suites and
source-image checks. Main keeps package/artifact builds without repeating the PR
suite. Tags retain their existing test/build/publish path. No tags or releases are
created here. The separate alternate-host pipeline retains its existing trigger
topology and main suites; it has not been executed during this reconciliation.

Static conflict/YAML/lock/source preservation checks do not prove Linux image or
shell runtime compatibility. Root must retain the final-head Ready hosted image
and trust-gate evidence before merge; no local Docker or live server is started.
