"""Tests for Pydantic models."""

import pytest

from src.models import (
    BranchRestriction,
    BranchSummary,
    CommentSummary,
    CommitDetail,
    CommitStatus,
    CommitSummary,
    DeploymentSummary,
    DirectoryEntry,
    EnvironmentSummary,
    GroupPermission,
    PipelineDetail,
    PipelineStep,
    PipelineSummary,
    ProjectDetail,
    ProjectSummary,
    PullRequestDetail,
    PullRequestSummary,
    RepositoryDetail,
    RepositorySummary,
    TagSummary,
    UserPermission,
    WebhookSummary,
    truncate_timestamp,
)


class TestTruncateTimestamp:
    def test_truncates_to_minutes(self):
        assert truncate_timestamp("2025-01-15T14:30:45.123456Z") == "2025-01-15T14:30"

    def test_handles_none(self):
        assert truncate_timestamp(None) is None

    def test_handles_empty_string(self):
        assert truncate_timestamp("") == ""

    def test_handles_short_string(self):
        assert truncate_timestamp("2025-01-15") == "2025-01-15"


class TestRepositorySummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "name": "my-repo",
            "full_name": "workspace/my-repo",
            "description": "A test repo",
            "is_private": True,
            "project": {"key": "PROJ"},
        }
        model = RepositorySummary.from_api(raw)
        assert model.name == "my-repo"
        assert model.full_name == "workspace/my-repo"
        assert model.description == "A test repo"
        assert model.private is True
        assert model.project == "PROJ"

    def test_truncates_description(self):
        raw = {
            "name": "repo",
            "full_name": "ws/repo",
            "description": "x" * 200,
            "is_private": True,
        }
        model = RepositorySummary.from_api(raw)
        assert len(model.description) == 100

    def test_handles_missing_project(self):
        raw = {
            "name": "repo",
            "full_name": "ws/repo",
            "project": None,
            "is_private": True,
        }
        model = RepositorySummary.from_api(raw)
        assert model.project is None

    def test_handles_none_description(self):
        raw = {
            "name": "repo",
            "full_name": "ws/repo",
            "description": None,
            "is_private": False,
        }
        model = RepositorySummary.from_api(raw)
        assert model.description == ""


class TestRepositoryDetail:
    def test_from_api_extracts_all_fields(self):
        raw = {
            "name": "my-repo",
            "full_name": "ws/my-repo",
            "description": "Description",
            "is_private": True,
            "created_on": "2025-01-01T00:00:00Z",
            "updated_on": "2025-01-02T00:00:00Z",
            "mainbranch": {"name": "main"},
            "project": {"key": "DS"},
        }
        clone_urls = {"https": "https://example.com", "ssh": "git@example.com"}
        model = RepositoryDetail.from_api(raw, clone_urls)
        assert model.name == "my-repo"
        assert model.mainbranch == "main"
        assert model.clone_urls == clone_urls
        assert model.project == "DS"

    def test_truncates_timestamps(self):
        raw = {
            "name": "repo",
            "full_name": "ws/repo",
            "is_private": True,
            "created_on": "2025-01-01T14:30:45.123456Z",
            "updated_on": "2025-01-02T09:15:32.789012Z",
        }
        model = RepositoryDetail.from_api(raw, {})
        assert model.created == "2025-01-01T14:30"
        assert model.updated == "2025-01-02T09:15"


class TestPullRequestSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "id": 123,
            "title": "My PR",
            "state": "OPEN",
            "author": {"display_name": "John"},
            "source": {"branch": {"name": "feature"}},
            "destination": {"branch": {"name": "main"}},
        }
        model = PullRequestSummary.from_api(raw, url="https://example.com/pr/123")
        assert model.id == 123
        assert model.title == "My PR"
        assert model.author == "John"
        assert model.source_branch == "feature"
        assert model.destination_branch == "main"
        assert model.url == "https://example.com/pr/123"

    def test_handles_missing_author(self):
        raw = {
            "id": 1,
            "title": "PR",
            "state": "OPEN",
            "author": None,
            "source": {"branch": {"name": "f"}},
            "destination": {"branch": {"name": "m"}},
        }
        model = PullRequestSummary.from_api(raw)
        assert model.author is None


class TestPullRequestDetail:
    def test_from_api_extracts_all_fields(self):
        raw = {
            "id": 456,
            "title": "Big PR",
            "description": "Long description",
            "state": "MERGED",
            "author": {"display_name": "Jane"},
            "source": {"branch": {"name": "feature-x"}},
            "destination": {"branch": {"name": "develop"}},
            "created_on": "2025-01-01T00:00:00Z",
            "updated_on": "2025-01-02T00:00:00Z",
            "comment_count": 5,
            "task_count": 2,
        }
        model = PullRequestDetail.from_api(raw, url="https://pr.url")
        assert model.id == 456
        assert model.description == "Long description"
        assert model.comment_count == 5
        assert model.task_count == 2

    def test_truncates_timestamps(self):
        raw = {
            "id": 1,
            "title": "PR",
            "state": "OPEN",
            "created_on": "2025-01-01T14:30:45.123456Z",
            "updated_on": "2025-01-02T09:15:32.789012Z",
        }
        model = PullRequestDetail.from_api(raw)
        assert model.created == "2025-01-01T14:30"
        assert model.updated == "2025-01-02T09:15"


class TestCommitSummary:
    def test_truncates_hash_to_12(self):
        raw = {
            "hash": "abc123def456789012345678901234567890",
            "message": "Commit message",
            "author": {"raw": "John <john@example.com>"},
            "date": "2025-01-01T00:00:00Z",
        }
        model = CommitSummary.from_api(raw)
        assert len(model.hash) == 12
        assert model.hash == "abc123def456"

    def test_extracts_first_line_of_message(self):
        raw = {
            "hash": "abc123",
            "message": "First line\nSecond line\nThird line",
            "author": {"raw": "Author"},
        }
        model = CommitSummary.from_api(raw)
        assert model.message == "First line"

    def test_handles_none_message(self):
        raw = {"hash": "abc123", "message": None, "author": {}}
        model = CommitSummary.from_api(raw)
        assert model.message == ""

    def test_truncates_date(self):
        raw = {
            "hash": "abc123",
            "message": "msg",
            "date": "2025-01-01T14:30:45.123456Z",
        }
        model = CommitSummary.from_api(raw)
        assert model.date == "2025-01-01T14:30"


class TestCommitDetail:
    def test_from_api_extracts_fields(self):
        raw = {
            "hash": "abc123def456",
            "message": "Full message here",
            "author": {
                "raw": "John <john@example.com>",
                "user": {"display_name": "John Doe"},
            },
            "date": "2025-01-01T00:00:00Z",
            "parents": [{"hash": "parent123456"}],
        }
        model = CommitDetail.from_api(raw)
        assert model.hash == "abc123def456"
        assert model.author_raw == "John <john@example.com>"
        assert model.author_user == "John Doe"
        assert model.parents == ["parent123456"]

    def test_truncates_date(self):
        raw = {
            "hash": "abc123",
            "date": "2025-01-01T14:30:45.123456Z",
        }
        model = CommitDetail.from_api(raw)
        assert model.date == "2025-01-01T14:30"


class TestBranchSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "name": "feature-branch",
            "target": {
                "hash": "abc123def456789",
                "message": "Latest commit\nMore details",
                "date": "2025-01-01T00:00:00Z",
            },
        }
        model = BranchSummary.from_api(raw)
        assert model.name == "feature-branch"
        assert model.commit == "abc123def456"
        assert model.message == "Latest commit"

    def test_truncates_date(self):
        raw = {
            "name": "branch",
            "target": {
                "hash": "abc123",
                "date": "2025-01-01T14:30:45.123456Z",
            },
        }
        model = BranchSummary.from_api(raw)
        assert model.date == "2025-01-01T14:30"


class TestPipelineSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "uuid": "{pipe-uuid}",
            "build_number": 42,
            "state": {"name": "COMPLETED", "result": {"name": "SUCCESSFUL"}},
            "target": {"ref_name": "main"},
            "created_on": "2025-01-01T00:00:00Z",
        }
        model = PipelineSummary.from_api(raw)
        assert model.uuid == "{pipe-uuid}"
        assert model.build_number == 42
        assert model.state == "COMPLETED"
        assert model.result == "SUCCESSFUL"
        assert model.branch == "main"

    def test_handles_no_result(self):
        raw = {
            "uuid": "{uuid}",
            "state": {"name": "IN_PROGRESS"},
            "target": {"ref_name": "dev"},
        }
        model = PipelineSummary.from_api(raw)
        assert model.state == "IN_PROGRESS"
        assert model.result is None

    def test_truncates_created(self):
        raw = {
            "uuid": "{uuid}",
            "state": {"name": "COMPLETED"},
            "created_on": "2025-01-01T14:30:45.123456Z",
        }
        model = PipelineSummary.from_api(raw)
        assert model.created == "2025-01-01T14:30"


class TestPipelineDetail:
    def test_from_api_extracts_all_fields(self):
        raw = {
            "uuid": "{uuid}",
            "build_number": 100,
            "state": {"name": "COMPLETED", "result": {"name": "FAILED"}},
            "target": {"ref_name": "main"},
            "created_on": "2025-01-01T00:00:00Z",
            "completed_on": "2025-01-01T01:00:00Z",
            "duration_in_seconds": 3600,
        }
        model = PipelineDetail.from_api(raw)
        assert model.duration_s == 3600
        assert model.result == "FAILED"

    def test_truncates_timestamps(self):
        raw = {
            "uuid": "{uuid}",
            "state": {"name": "COMPLETED"},
            "created_on": "2025-01-01T14:30:45.123456Z",
            "completed_on": "2025-01-01T15:45:32.789012Z",
        }
        model = PipelineDetail.from_api(raw)
        assert model.created == "2025-01-01T14:30"
        assert model.completed == "2025-01-01T15:45"


class TestPipelineStep:
    def test_from_api_extracts_fields(self):
        raw = {
            "uuid": "{step-uuid}",
            "name": "Build",
            "state": {"name": "COMPLETED", "result": {"name": "SUCCESSFUL"}},
        }
        model = PipelineStep.from_api(raw)
        assert model.uuid == "{step-uuid}"
        assert model.name == "Build"
        assert model.state == "COMPLETED"
        assert model.result == "SUCCESSFUL"


class TestTagSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "name": "v1.0.0",
            "target": {"hash": "abc123def456789"},
            "message": "Release tag",
            "tagger": {"raw": "John <john@example.com>"},
            "date": "2025-01-01T00:00:00Z",
        }
        model = TagSummary.from_api(raw)
        assert model.name == "v1.0.0"
        assert model.target == "abc123def456"
        assert model.message == "Release tag"
        assert model.tagger == "John <john@example.com>"

    def test_handles_none_target(self):
        raw = {"name": "tag", "target": None, "tagger": None}
        model = TagSummary.from_api(raw)
        assert model.target == ""
        assert model.tagger is None

    def test_truncates_date(self):
        raw = {
            "name": "v1.0.0",
            "target": {"hash": "abc123"},
            "date": "2025-01-01T14:30:45.123456Z",
        }
        model = TagSummary.from_api(raw)
        assert model.date == "2025-01-01T14:30"

    def test_lightweight_tag_excludes_none(self):
        """Lightweight tags (no annotation) exclude empty fields from output."""
        raw = {
            "name": "v1.0.0",
            "target": {"hash": "abc123def456789"},
            "message": None,
            "tagger": None,
            "date": None,
        }
        model = TagSummary.from_api(raw)
        dumped = model.model_dump()
        assert dumped == {"name": "v1.0.0", "target": "abc123def456"}
        assert "message" not in dumped
        assert "tagger" not in dumped
        assert "date" not in dumped

    def test_annotated_tag_includes_all(self):
        """Annotated tags include message, tagger, and date."""
        raw = {
            "name": "v1.0.0",
            "target": {"hash": "abc123def456789"},
            "message": "Release",
            "tagger": {"raw": "John <john@example.com>"},
            "date": "2025-01-01T14:30:00Z",
        }
        model = TagSummary.from_api(raw)
        dumped = model.model_dump()
        assert dumped["message"] == "Release"
        assert dumped["tagger"] == "John <john@example.com>"
        assert dumped["date"] == "2025-01-01T14:30"


class TestProjectSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "key": "PROJ",
            "name": "My Project",
            "description": "Project description",
            "is_private": True,
            "created_on": "2025-01-01T00:00:00Z",
        }
        model = ProjectSummary.from_api(raw)
        assert model.key == "PROJ"
        assert model.name == "My Project"
        assert model.description == "Project description"
        assert model.private is True

    def test_truncates_description(self):
        raw = {
            "key": "P",
            "name": "P",
            "description": "x" * 200,
            "is_private": True,
        }
        model = ProjectSummary.from_api(raw)
        assert len(model.description) == 100

    def test_truncates_created(self):
        raw = {
            "key": "P",
            "name": "P",
            "is_private": True,
            "created_on": "2025-01-01T14:30:45.123456Z",
        }
        model = ProjectSummary.from_api(raw)
        assert model.created == "2025-01-01T14:30"


class TestProjectDetail:
    def test_truncates_timestamps(self):
        raw = {
            "key": "P",
            "name": "P",
            "is_private": True,
            "created_on": "2025-01-01T14:30:45.123456Z",
            "updated_on": "2025-01-02T09:15:32.789012Z",
        }
        model = ProjectDetail.from_api(raw)
        assert model.created == "2025-01-01T14:30"
        assert model.updated == "2025-01-02T09:15"


class TestWebhookSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "uuid": "{webhook-uuid}",
            "url": "https://example.com/webhook",
            "description": "My webhook",
            "events": ["repo:push", "pullrequest:created"],
            "active": True,
            "created_at": "2025-01-01T00:00:00Z",
        }
        model = WebhookSummary.from_api(raw)
        assert model.uuid == "{webhook-uuid}"
        assert model.url == "https://example.com/webhook"
        assert model.events == ["repo:push", "pullrequest:created"]

    def test_truncates_created(self):
        raw = {
            "uuid": "{uuid}",
            "url": "https://example.com",
            "created_at": "2025-01-01T14:30:45.123456Z",
        }
        model = WebhookSummary.from_api(raw)
        assert model.created == "2025-01-01T14:30"


class TestEnvironmentSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "uuid": "{env-uuid}",
            "name": "production",
            "environment_type": {"name": "Production"},
            "rank": 1,
        }
        model = EnvironmentSummary.from_api(raw)
        assert model.uuid == "{env-uuid}"
        assert model.name == "production"
        assert model.environment_type == "Production"
        assert model.rank == 1


class TestDeploymentSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "uuid": "{deploy-uuid}",
            "state": {
                "name": "COMPLETED",
                "started_on": "2025-01-01T00:00:00Z",
                "completed_on": "2025-01-01T01:00:00Z",
            },
            "commit": {"hash": "abc123def456789"},
            "release": {"pipeline": {"uuid": "{pipe-uuid}"}},
        }
        model = DeploymentSummary.from_api(raw)
        assert model.uuid == "{deploy-uuid}"
        assert model.state == "COMPLETED"
        assert model.commit == "abc123def456"
        assert model.pipeline_uuid == "{pipe-uuid}"

    def test_truncates_timestamps(self):
        raw = {
            "uuid": "{uuid}",
            "state": {
                "name": "COMPLETED",
                "started_on": "2025-01-01T14:30:45.123456Z",
                "completed_on": "2025-01-01T15:45:32.789012Z",
            },
        }
        model = DeploymentSummary.from_api(raw)
        assert model.started == "2025-01-01T14:30"
        assert model.completed == "2025-01-01T15:45"


class TestCommentSummary:
    def test_from_api_extracts_fields(self):
        raw = {
            "id": 123,
            "user": {"display_name": "Commenter"},
            "content": {"raw": "Great PR!"},
            "created_on": "2025-01-01T00:00:00Z",
            "inline": {"path": "src/main.py", "to": 42},
        }
        model = CommentSummary.from_api(raw)
        assert model.id == 123
        assert model.author == "Commenter"
        assert model.content == "Great PR!"
        assert model.inline == {"path": "src/main.py", "to": 42}

    def test_truncates_timestamps(self):
        raw = {
            "id": 1,
            "created_on": "2025-01-01T14:30:45.123456Z",
            "updated_on": "2025-01-02T09:15:32.789012Z",
        }
        model = CommentSummary.from_api(raw)
        assert model.created == "2025-01-01T14:30"
        assert model.updated == "2025-01-02T09:15"


class TestCommitStatus:
    def test_from_api_extracts_fields(self):
        raw = {
            "key": "ci-build",
            "name": "CI Build",
            "state": "SUCCESSFUL",
            "description": "All tests passed",
            "url": "https://ci.example.com/build/123",
            "created_on": "2025-01-01T00:00:00Z",
        }
        model = CommitStatus.from_api(raw)
        assert model.key == "ci-build"
        assert model.state == "SUCCESSFUL"
        assert model.url == "https://ci.example.com/build/123"

    def test_truncates_timestamps(self):
        raw = {
            "key": "ci",
            "state": "SUCCESSFUL",
            "created_on": "2025-01-01T14:30:45.123456Z",
            "updated_on": "2025-01-02T09:15:32.789012Z",
        }
        model = CommitStatus.from_api(raw)
        assert model.created == "2025-01-01T14:30"
        assert model.updated == "2025-01-02T09:15"


class TestBranchRestriction:
    def test_from_api_extracts_fields(self):
        raw = {
            "id": 1,
            "kind": "require_approvals_to_merge",
            "pattern": "main",
            "branch_match_kind": "glob",
            "value": 2,
            "users": [{"display_name": "Admin"}],
            "groups": [{"name": "Developers"}],
        }
        model = BranchRestriction.from_api(raw)
        assert model.id == 1
        assert model.kind == "require_approvals_to_merge"
        assert model.pattern == "main"
        assert model.value == 2
        assert model.users == ["Admin"]
        assert model.groups == ["Developers"]


class TestUserPermission:
    def test_from_api_extracts_fields(self):
        raw = {
            "user": {"display_name": "John", "account_id": "123abc"},
            "permission": "write",
        }
        model = UserPermission.from_api(raw)
        assert model.user == "John"
        assert model.account_id == "123abc"
        assert model.permission == "write"


class TestGroupPermission:
    def test_from_api_extracts_fields(self):
        raw = {
            "group": {"name": "Developers", "slug": "developers"},
            "permission": "admin",
        }
        model = GroupPermission.from_api(raw)
        assert model.group == "Developers"
        assert model.slug == "developers"
        assert model.permission == "admin"


class TestDirectoryEntry:
    def test_from_api_extracts_fields(self):
        raw = {"path": "src/main.py", "type": "commit_file", "size": 1024}
        model = DirectoryEntry.from_api(raw)
        assert model.path == "src/main.py"
        assert model.type == "commit_file"
        assert model.size == 1024
