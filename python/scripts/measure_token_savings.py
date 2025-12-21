#!/usr/bin/env python3
"""Script to measure token savings from context engineering optimizations.

Compares old vs new response formats and estimates token savings.
Uses tiktoken for accurate token counting (cl100k_base encoding used by Claude).
"""

import json
import sys

try:
    import tiktoken
except ImportError:
    print("Installing tiktoken...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "tiktoken", "-q"])
    import tiktoken


def count_tokens(text: str) -> int:
    """Count tokens using cl100k_base encoding (Claude-compatible)."""
    enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


def compare_responses(name: str, old: dict, new: dict) -> dict:
    """Compare old and new response formats."""
    old_json = json.dumps(old, indent=2)
    new_json = json.dumps(new, indent=2)

    old_tokens = count_tokens(old_json)
    new_tokens = count_tokens(new_json)
    saved = old_tokens - new_tokens
    pct = (saved / old_tokens * 100) if old_tokens > 0 else 0

    return {
        "name": name,
        "old_tokens": old_tokens,
        "new_tokens": new_tokens,
        "saved": saved,
        "pct": pct,
    }


# ==================== TEST CASES ====================

test_cases = []

# 1. list_repositories (2 repos)
test_cases.append(("list_repositories", {
    "count": 2,
    "search": "api",
    "query": 'name ~ "api"',
    "repositories": [
        {"name": "api-gateway", "full_name": "ws/api-gateway", "description": "API Gateway service", "is_private": True, "project": "BACKEND"},
        {"name": "api-docs", "full_name": "ws/api-docs", "description": "API Documentation", "is_private": False, "project": "DOCS"},
    ]
}, {
    "repositories": [
        {"name": "api-gateway", "full_name": "ws/api-gateway", "description": "API Gateway service", "private": True, "project": "BACKEND"},
        {"name": "api-docs", "full_name": "ws/api-docs", "description": "API Documentation", "private": False, "project": "DOCS"},
    ]
}))

# 2. create_repository
test_cases.append(("create_repository", {
    "success": True,
    "name": "my-new-repo",
    "full_name": "workspace/my-new-repo",
    "clone_urls": {
        "https": "https://bitbucket.org/workspace/my-new-repo.git",
        "ssh": "git@bitbucket.org:workspace/my-new-repo.git",
        "html": "https://bitbucket.org/workspace/my-new-repo"
    },
    "html_url": "https://bitbucket.org/workspace/my-new-repo"
}, {
    "name": "my-new-repo",
    "full_name": "workspace/my-new-repo",
    "clone_urls": {
        "https": "https://bitbucket.org/workspace/my-new-repo.git",
        "ssh": "git@bitbucket.org:workspace/my-new-repo.git",
        "html": "https://bitbucket.org/workspace/my-new-repo"
    },
}))

# 3. delete_repository
test_cases.append(("delete_repository", {
    "success": True,
    "message": "Repository 'my-repo' deleted"
}, {}))

# 4. create_pull_request
test_cases.append(("create_pull_request", {
    "success": True,
    "id": 123,
    "title": "Add new feature",
    "state": "OPEN",
    "url": "https://bitbucket.org/ws/repo/pull-requests/123",
    "source_branch": "feature/new-feature",
    "destination_branch": "main",
}, {
    "id": 123,
    "title": "Add new feature",
    "state": "OPEN",
    "url": "https://bitbucket.org/ws/repo/pull-requests/123",
}))

# 5. list_pull_requests (3 PRs)
test_cases.append(("list_pull_requests", {
    "count": 3,
    "state_filter": "OPEN",
    "pull_requests": [
        {"id": 1, "title": "PR 1", "state": "OPEN", "author": "John", "source_branch": "feat-1", "destination_branch": "main", "url": "https://bb.org/pr/1"},
        {"id": 2, "title": "PR 2", "state": "OPEN", "author": "Jane", "source_branch": "feat-2", "destination_branch": "main", "url": "https://bb.org/pr/2"},
        {"id": 3, "title": "PR 3", "state": "OPEN", "author": "Bob", "source_branch": "feat-3", "destination_branch": "main", "url": "https://bb.org/pr/3"},
    ]
}, {
    "pull_requests": [
        {"id": 1, "title": "PR 1", "state": "OPEN", "author": "John", "source_branch": "feat-1", "destination_branch": "main", "url": "https://bb.org/pr/1"},
        {"id": 2, "title": "PR 2", "state": "OPEN", "author": "Jane", "source_branch": "feat-2", "destination_branch": "main", "url": "https://bb.org/pr/2"},
        {"id": 3, "title": "PR 3", "state": "OPEN", "author": "Bob", "source_branch": "feat-3", "destination_branch": "main", "url": "https://bb.org/pr/3"},
    ]
}))

# 6. trigger_pipeline
test_cases.append(("trigger_pipeline", {
    "success": True,
    "uuid": "{abc-123-def-456}",
    "build_number": 42,
    "state": "PENDING",
    "branch": "main",
    "created_on": "2025-01-15T14:30:45.123456Z",
}, {
    "uuid": "{abc-123-def-456}",
    "build_number": 42,
    "state": "PENDING",
}))

# 7. list_commits (5 commits)
test_cases.append(("list_commits", {
    "count": 5,
    "branch": "main",
    "path": None,
    "commits": [
        {"hash": "abc123def456", "full_hash": "abc123def456789012345678901234567890", "message": "First commit", "author": "John <john@example.com>", "date": "2025-01-15T14:30:45.123456Z"},
        {"hash": "def456ghi789", "full_hash": "def456ghi789012345678901234567890abcd", "message": "Second commit", "author": "Jane <jane@example.com>", "date": "2025-01-14T10:20:30.456789Z"},
        {"hash": "ghi789jkl012", "full_hash": "ghi789jkl012345678901234567890efgh", "message": "Third commit", "author": "Bob <bob@example.com>", "date": "2025-01-13T08:15:22.789012Z"},
        {"hash": "jkl012mno345", "full_hash": "jkl012mno345678901234567890ijkl", "message": "Fourth commit", "author": "Alice <alice@example.com>", "date": "2025-01-12T16:45:55.012345Z"},
        {"hash": "mno345pqr678", "full_hash": "mno345pqr678901234567890mnop", "message": "Fifth commit", "author": "Charlie <charlie@example.com>", "date": "2025-01-11T12:00:00.345678Z"},
    ]
}, {
    "commits": [
        {"hash": "abc123def456", "message": "First commit", "author": "John <john@example.com>", "date": "2025-01-15T14:30"},
        {"hash": "def456ghi789", "message": "Second commit", "author": "Jane <jane@example.com>", "date": "2025-01-14T10:20"},
        {"hash": "ghi789jkl012", "message": "Third commit", "author": "Bob <bob@example.com>", "date": "2025-01-13T08:15"},
        {"hash": "jkl012mno345", "message": "Fourth commit", "author": "Alice <alice@example.com>", "date": "2025-01-12T16:45"},
        {"hash": "mno345pqr678", "message": "Fifth commit", "author": "Charlie <charlie@example.com>", "date": "2025-01-11T12:00"},
    ]
}))

# 8. compare_commits (10 files)
test_cases.append(("compare_commits", {
    "base": "main",
    "head": "feature-branch",
    "files_changed": 10,
    "files": [
        {"path": "src/main.py", "status": "modified", "lines_added": 50, "lines_removed": 20},
        {"path": "src/utils.py", "status": "modified", "lines_added": 15, "lines_removed": 5},
        {"path": "src/new_module.py", "status": "added", "lines_added": 100, "lines_removed": 0},
        {"path": "tests/test_main.py", "status": "modified", "lines_added": 30, "lines_removed": 10},
        {"path": "tests/test_utils.py", "status": "modified", "lines_added": 20, "lines_removed": 8},
        {"path": "docs/README.md", "status": "modified", "lines_added": 25, "lines_removed": 5},
        {"path": "config/settings.py", "status": "modified", "lines_added": 10, "lines_removed": 3},
        {"path": "old_file.py", "status": "removed", "lines_added": 0, "lines_removed": 150},
        {"path": "scripts/deploy.sh", "status": "added", "lines_added": 45, "lines_removed": 0},
        {"path": "requirements.txt", "status": "modified", "lines_added": 5, "lines_removed": 2},
    ]
}, {
    "files": [
        {"path": "src/main.py", "status": "modified", "+": 50, "-": 20},
        {"path": "src/utils.py", "status": "modified", "+": 15, "-": 5},
        {"path": "src/new_module.py", "status": "added", "+": 100, "-": 0},
        {"path": "tests/test_main.py", "status": "modified", "+": 30, "-": 10},
        {"path": "tests/test_utils.py", "status": "modified", "+": 20, "-": 8},
        {"path": "docs/README.md", "status": "modified", "+": 25, "-": 5},
        {"path": "config/settings.py", "status": "modified", "+": 10, "-": 3},
        {"path": "old_file.py", "status": "removed", "+": 0, "-": 150},
        {"path": "scripts/deploy.sh", "status": "added", "+": 45, "-": 0},
        {"path": "requirements.txt", "status": "modified", "+": 5, "-": 2},
    ]
}))

# 9. get_repository (detailed)
test_cases.append(("get_repository", {
    "name": "my-repo",
    "full_name": "ws/my-repo",
    "description": "A sample repository for testing purposes",
    "is_private": True,
    "created_on": "2025-01-01T14:30:45.123456+00:00",
    "updated_on": "2025-01-15T09:15:32.789012+00:00",
    "mainbranch": "main",
    "clone_urls": {"https": "https://bitbucket.org/ws/my-repo.git", "ssh": "git@bitbucket.org:ws/my-repo.git"},
    "project": "DS"
}, {
    "name": "my-repo",
    "full_name": "ws/my-repo",
    "description": "A sample repository for testing purposes",
    "private": True,
    "created": "2025-01-01T14:30",
    "updated": "2025-01-15T09:15",
    "mainbranch": "main",
    "clone_urls": {"https": "https://bitbucket.org/ws/my-repo.git", "ssh": "git@bitbucket.org:ws/my-repo.git"},
    "project": "DS"
}))

# 10. list_branches (5 branches)
test_cases.append(("list_branches", {
    "count": 5,
    "branches": [
        {"name": "main", "target_hash": "abc123def456", "target_message": "Merge PR #42", "target_date": "2025-01-15T14:30:45.123456Z"},
        {"name": "develop", "target_hash": "def456ghi789", "target_message": "WIP: new feature", "target_date": "2025-01-14T10:20:30.456789Z"},
        {"name": "feature/auth", "target_hash": "ghi789jkl012", "target_message": "Add authentication", "target_date": "2025-01-13T08:15:22.789012Z"},
        {"name": "feature/api", "target_hash": "jkl012mno345", "target_message": "API endpoints", "target_date": "2025-01-12T16:45:55.012345Z"},
        {"name": "hotfix/bug", "target_hash": "mno345pqr678", "target_message": "Fix critical bug", "target_date": "2025-01-11T12:00:00.345678Z"},
    ]
}, {
    "branches": [
        {"name": "main", "commit": "abc123def456", "message": "Merge PR #42", "date": "2025-01-15T14:30"},
        {"name": "develop", "commit": "def456ghi789", "message": "WIP: new feature", "date": "2025-01-14T10:20"},
        {"name": "feature/auth", "commit": "ghi789jkl012", "message": "Add authentication", "date": "2025-01-13T08:15"},
        {"name": "feature/api", "commit": "jkl012mno345", "message": "API endpoints", "date": "2025-01-12T16:45"},
        {"name": "hotfix/bug", "commit": "mno345pqr678", "message": "Fix critical bug", "date": "2025-01-11T12:00"},
    ]
}))

# 11. approve_pr
test_cases.append(("approve_pr", {
    "success": True,
    "pr_id": 123,
    "approved_by": "John Doe",
    "approved_on": "2025-01-15T14:30:45.123456Z",
}, {
    "pr_id": 123,
    "approved_by": "John Doe",
}))

# 12. list_pipelines (3 pipelines)
test_cases.append(("list_pipelines", {
    "count": 3,
    "pipelines": [
        {"uuid": "{pipe-1}", "build_number": 100, "state": "COMPLETED", "result": "SUCCESSFUL", "branch": "main", "created_on": "2025-01-15T14:30:45.123456Z"},
        {"uuid": "{pipe-2}", "build_number": 99, "state": "COMPLETED", "result": "FAILED", "branch": "develop", "created_on": "2025-01-14T10:20:30.456789Z"},
        {"uuid": "{pipe-3}", "build_number": 98, "state": "IN_PROGRESS", "result": None, "branch": "feature/x", "created_on": "2025-01-13T08:15:22.789012Z"},
    ]
}, {
    "pipelines": [
        {"uuid": "{pipe-1}", "build_number": 100, "state": "COMPLETED", "result": "SUCCESSFUL", "branch": "main", "created": "2025-01-15T14:30"},
        {"uuid": "{pipe-2}", "build_number": 99, "state": "COMPLETED", "result": "FAILED", "branch": "develop", "created": "2025-01-14T10:20"},
        {"uuid": "{pipe-3}", "build_number": 98, "state": "IN_PROGRESS", "result": None, "branch": "feature/x", "created": "2025-01-13T08:15"},
    ]
}))


def main():
    print("=" * 70)
    print("TOKEN SAVINGS ANALYSIS - Context Engineering v0.6.0")
    print("=" * 70)
    print()

    results = []
    total_old = 0
    total_new = 0

    for name, old, new in test_cases:
        result = compare_responses(name, old, new)
        results.append(result)
        total_old += result["old_tokens"]
        total_new += result["new_tokens"]

    # Print individual results
    print(f"{'Tool':<25} {'Old':>8} {'New':>8} {'Saved':>8} {'%':>8}")
    print("-" * 70)

    for r in results:
        print(f"{r['name']:<25} {r['old_tokens']:>8} {r['new_tokens']:>8} {r['saved']:>8} {r['pct']:>7.1f}%")

    print("-" * 70)

    # Summary
    total_saved = total_old - total_new
    total_pct = (total_saved / total_old * 100) if total_old > 0 else 0

    print(f"{'TOTAL':<25} {total_old:>8} {total_new:>8} {total_saved:>8} {total_pct:>7.1f}%")
    print()

    # Categorized summary
    print("=" * 70)
    print("SAVINGS BY CATEGORY")
    print("=" * 70)

    categories = {
        "Writes (create/delete/update)": ["create_repository", "delete_repository", "create_pull_request", "trigger_pipeline", "approve_pr"],
        "Lists": ["list_repositories", "list_pull_requests", "list_commits", "list_branches", "list_pipelines"],
        "Detailed responses": ["get_repository", "compare_commits"],
    }

    for cat_name, tools in categories.items():
        cat_results = [r for r in results if r["name"] in tools]
        if cat_results:
            cat_old = sum(r["old_tokens"] for r in cat_results)
            cat_new = sum(r["new_tokens"] for r in cat_results)
            cat_saved = cat_old - cat_new
            cat_pct = (cat_saved / cat_old * 100) if cat_old > 0 else 0
            print(f"{cat_name}: {cat_saved} tokens saved ({cat_pct:.1f}%)")

    print()
    print("=" * 70)
    print(f"OVERALL: {total_saved} tokens saved ({total_pct:.1f}% reduction)")
    print("=" * 70)

    # Cost estimation (rough, based on Claude pricing)
    # Claude Sonnet: ~$3/M input, $15/M output
    input_cost_per_m = 3.0
    output_cost_per_m = 15.0

    # Assume tool responses are primarily input tokens for the model
    cost_saved_per_1000_calls = (total_saved / len(test_cases)) * 1000 / 1_000_000 * input_cost_per_m

    print()
    print(f"Estimated cost savings: ${cost_saved_per_1000_calls:.4f} per 1000 tool calls")
    print(f"(Based on average of {total_saved // len(test_cases)} tokens saved per call)")


if __name__ == "__main__":
    main()
