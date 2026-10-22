# Delivery profile

## vcs
- host: GitHub JaviMaligno/mcp-server-bitbucket
- integration-branch: main
- production-branch: main
Source: fetched origin/main and authenticated gh account · checked 2026-10-22

## ci
- kind: GitHub Actions
- on-push-branch: main tests and package builds
- on-tag: tests and public package publishing; no tags in this task
Source: .github/workflows/ci.yml · checked 2026-10-22

## environments
- test-env: local-and-ci-tests
- production-env: public-package-registry
Source: GitHub workflow; no deployed service or public package release in this task · checked 2026-10-22

## tracker
- kind: none
Source: user-requested local-clone security follow-up · checked 2026-10-22
