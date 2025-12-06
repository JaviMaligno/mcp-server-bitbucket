"""Pydantic models for Bitbucket API responses.

These models handle transformation from raw API responses to clean,
typed dictionaries for MCP tool responses.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, field_validator


# ==================== REPOSITORIES ====================


class RepositorySummary(BaseModel):
    """Repository info for list responses."""

    name: str
    full_name: str
    description: str = ""
    is_private: bool = True
    project: Optional[str] = None

    @field_validator("description", mode="before")
    @classmethod
    def truncate_description(cls, v: Any) -> str:
        return (v or "")[:100]

    @classmethod
    def from_api(cls, data: dict) -> "RepositorySummary":
        return cls(
            name=data.get("name", ""),
            full_name=data.get("full_name", ""),
            description=data.get("description"),
            is_private=data.get("is_private", True),
            project=(data.get("project") or {}).get("key"),
        )


class RepositoryDetail(BaseModel):
    """Repository info for get responses."""

    name: str
    full_name: str
    description: str = ""
    is_private: bool = True
    created_on: Optional[str] = None
    updated_on: Optional[str] = None
    mainbranch: Optional[str] = None
    clone_urls: dict[str, str] = {}
    project: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict, clone_urls: dict[str, str]) -> "RepositoryDetail":
        return cls(
            name=data.get("name", ""),
            full_name=data.get("full_name", ""),
            description=data.get("description", ""),
            is_private=data.get("is_private", True),
            created_on=data.get("created_on"),
            updated_on=data.get("updated_on"),
            mainbranch=(data.get("mainbranch") or {}).get("name"),
            clone_urls=clone_urls,
            project=(data.get("project") or {}).get("key"),
        )


# ==================== PULL REQUESTS ====================


class PullRequestSummary(BaseModel):
    """PR info for list responses."""

    id: int
    title: str
    state: str
    author: Optional[str] = None
    source_branch: Optional[str] = None
    destination_branch: Optional[str] = None
    url: str = ""

    @classmethod
    def from_api(cls, data: dict, url: str = "") -> "PullRequestSummary":
        return cls(
            id=data.get("id", 0),
            title=data.get("title", ""),
            state=data.get("state", ""),
            author=(data.get("author") or {}).get("display_name"),
            source_branch=(data.get("source") or {}).get("branch", {}).get("name"),
            destination_branch=(data.get("destination") or {}).get("branch", {}).get("name"),
            url=url,
        )


class PullRequestDetail(BaseModel):
    """PR info for get responses."""

    id: int
    title: str
    description: str = ""
    state: str
    author: Optional[str] = None
    source_branch: Optional[str] = None
    destination_branch: Optional[str] = None
    created_on: Optional[str] = None
    updated_on: Optional[str] = None
    url: str = ""
    comment_count: int = 0
    task_count: int = 0

    @classmethod
    def from_api(cls, data: dict, url: str = "") -> "PullRequestDetail":
        return cls(
            id=data.get("id", 0),
            title=data.get("title", ""),
            description=data.get("description", ""),
            state=data.get("state", ""),
            author=(data.get("author") or {}).get("display_name"),
            source_branch=(data.get("source") or {}).get("branch", {}).get("name"),
            destination_branch=(data.get("destination") or {}).get("branch", {}).get("name"),
            created_on=data.get("created_on"),
            updated_on=data.get("updated_on"),
            url=url,
            comment_count=data.get("comment_count", 0),
            task_count=data.get("task_count", 0),
        )


# ==================== COMMITS ====================


class CommitSummary(BaseModel):
    """Commit info for list responses."""

    hash: str
    full_hash: str
    message: str
    author: str = ""
    date: Optional[str] = None

    @field_validator("hash", mode="before")
    @classmethod
    def truncate_hash(cls, v: Any) -> str:
        return (v or "")[:12]

    @field_validator("message", mode="before")
    @classmethod
    def first_line(cls, v: Any) -> str:
        return (v or "").split("\n")[0]

    @classmethod
    def from_api(cls, data: dict) -> "CommitSummary":
        return cls(
            hash=data.get("hash", ""),
            full_hash=data.get("hash", ""),
            message=data.get("message"),
            author=(data.get("author") or {}).get("raw", ""),
            date=data.get("date"),
        )


class CommitDetail(BaseModel):
    """Commit info for get responses."""

    hash: str
    message: str = ""
    author_raw: Optional[str] = None
    author_user: Optional[str] = None
    date: Optional[str] = None
    parents: list[str] = []

    @classmethod
    def from_api(cls, data: dict) -> "CommitDetail":
        author = data.get("author") or {}
        return cls(
            hash=data.get("hash", ""),
            message=data.get("message", ""),
            author_raw=author.get("raw"),
            author_user=(author.get("user") or {}).get("display_name"),
            date=data.get("date"),
            parents=[(p.get("hash") or "")[:12] for p in data.get("parents", [])],
        )


# ==================== BRANCHES ====================


class BranchSummary(BaseModel):
    """Branch info for list responses."""

    name: str
    target_hash: str
    target_message: str = ""
    target_date: Optional[str] = None

    @field_validator("target_hash", mode="before")
    @classmethod
    def truncate_hash(cls, v: Any) -> str:
        return (v or "")[:12]

    @field_validator("target_message", mode="before")
    @classmethod
    def first_line(cls, v: Any) -> str:
        return (v or "").split("\n")[0]

    @classmethod
    def from_api(cls, data: dict) -> "BranchSummary":
        target = data.get("target") or {}
        return cls(
            name=data.get("name", ""),
            target_hash=target.get("hash", ""),
            target_message=target.get("message"),
            target_date=target.get("date"),
        )


# ==================== PIPELINES ====================


class PipelineSummary(BaseModel):
    """Pipeline info for list responses."""

    uuid: str
    build_number: Optional[int] = None
    state: Optional[str] = None
    result: Optional[str] = None
    branch: Optional[str] = None
    created_on: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "PipelineSummary":
        state_data = data.get("state") or {}
        result_data = state_data.get("result") or {}
        return cls(
            uuid=data.get("uuid", ""),
            build_number=data.get("build_number"),
            state=state_data.get("name"),
            result=result_data.get("name") if result_data else None,
            branch=(data.get("target") or {}).get("ref_name"),
            created_on=data.get("created_on"),
        )


class PipelineDetail(BaseModel):
    """Pipeline info for get responses."""

    uuid: str
    build_number: Optional[int] = None
    state: Optional[str] = None
    result: Optional[str] = None
    branch: Optional[str] = None
    created_on: Optional[str] = None
    completed_on: Optional[str] = None
    duration_in_seconds: Optional[int] = None

    @classmethod
    def from_api(cls, data: dict) -> "PipelineDetail":
        state_data = data.get("state") or {}
        result_data = state_data.get("result") or {}
        return cls(
            uuid=data.get("uuid", ""),
            build_number=data.get("build_number"),
            state=state_data.get("name"),
            result=result_data.get("name") if result_data else None,
            branch=(data.get("target") or {}).get("ref_name"),
            created_on=data.get("created_on"),
            completed_on=data.get("completed_on"),
            duration_in_seconds=data.get("duration_in_seconds"),
        )


class PipelineStep(BaseModel):
    """Pipeline step info."""

    uuid: str
    name: Optional[str] = None
    state: Optional[str] = None
    result: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "PipelineStep":
        state_data = data.get("state") or {}
        result_data = state_data.get("result") or {}
        return cls(
            uuid=data.get("uuid", ""),
            name=data.get("name"),
            state=state_data.get("name"),
            result=result_data.get("name") if result_data else None,
        )


# ==================== TAGS ====================


class TagSummary(BaseModel):
    """Tag info for list responses."""

    name: str
    target: str
    message: Optional[str] = None
    tagger: str = ""
    date: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "TagSummary":
        target = data.get("target") or {}
        tagger = data.get("tagger") or {}
        return cls(
            name=data.get("name", ""),
            target=(target.get("hash") or "")[:12],
            message=data.get("message"),
            tagger=tagger.get("raw", ""),
            date=data.get("date"),
        )


# ==================== PROJECTS ====================


class ProjectSummary(BaseModel):
    """Project info for list responses."""

    key: str
    name: str
    description: str = ""
    is_private: bool = True
    created_on: Optional[str] = None

    @field_validator("description", mode="before")
    @classmethod
    def truncate_description(cls, v: Any) -> str:
        return (v or "")[:100]

    @classmethod
    def from_api(cls, data: dict) -> "ProjectSummary":
        return cls(
            key=data.get("key", ""),
            name=data.get("name", ""),
            description=data.get("description"),
            is_private=data.get("is_private", True),
            created_on=data.get("created_on"),
        )


class ProjectDetail(BaseModel):
    """Project info for get responses."""

    key: str
    name: str
    description: str = ""
    is_private: bool = True
    created_on: Optional[str] = None
    updated_on: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "ProjectDetail":
        return cls(
            key=data.get("key", ""),
            name=data.get("name", ""),
            description=data.get("description", ""),
            is_private=data.get("is_private", True),
            created_on=data.get("created_on"),
            updated_on=data.get("updated_on"),
        )


# ==================== WEBHOOKS ====================


class WebhookSummary(BaseModel):
    """Webhook info for list responses."""

    uuid: str
    url: str
    description: str = ""
    events: list[str] = []
    active: bool = True
    created_at: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "WebhookSummary":
        return cls(
            uuid=data.get("uuid", ""),
            url=data.get("url", ""),
            description=data.get("description", ""),
            events=data.get("events", []),
            active=data.get("active", True),
            created_at=data.get("created_at"),
        )


# ==================== ENVIRONMENTS & DEPLOYMENTS ====================


class EnvironmentSummary(BaseModel):
    """Environment info for list responses."""

    uuid: str
    name: str
    environment_type: Optional[str] = None
    rank: Optional[int] = None

    @classmethod
    def from_api(cls, data: dict) -> "EnvironmentSummary":
        return cls(
            uuid=data.get("uuid", ""),
            name=data.get("name", ""),
            environment_type=(data.get("environment_type") or {}).get("name"),
            rank=data.get("rank"),
        )


class DeploymentSummary(BaseModel):
    """Deployment info for history responses."""

    uuid: str
    state: Optional[str] = None
    commit: str = ""
    pipeline_uuid: Optional[str] = None
    started_on: Optional[str] = None
    completed_on: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "DeploymentSummary":
        state_data = data.get("state") or {}
        release = data.get("release") or {}
        pipeline = release.get("pipeline") or {}
        return cls(
            uuid=data.get("uuid", ""),
            state=state_data.get("name"),
            commit=((data.get("commit") or {}).get("hash") or "")[:12],
            pipeline_uuid=pipeline.get("uuid"),
            started_on=state_data.get("started_on"),
            completed_on=state_data.get("completed_on"),
        )


# ==================== COMMENTS ====================


class CommentSummary(BaseModel):
    """Comment info for list responses."""

    id: int
    author: Optional[str] = None
    content: str = ""
    created_on: Optional[str] = None
    updated_on: Optional[str] = None
    inline: Optional[dict] = None

    @classmethod
    def from_api(cls, data: dict) -> "CommentSummary":
        return cls(
            id=data.get("id", 0),
            author=(data.get("user") or {}).get("display_name"),
            content=(data.get("content") or {}).get("raw", ""),
            created_on=data.get("created_on"),
            updated_on=data.get("updated_on"),
            inline=data.get("inline"),
        )


# ==================== COMMIT STATUSES ====================


class CommitStatus(BaseModel):
    """Commit status info."""

    key: str
    name: Optional[str] = None
    state: str
    description: str = ""
    url: Optional[str] = None
    created_on: Optional[str] = None
    updated_on: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict) -> "CommitStatus":
        return cls(
            key=data.get("key", ""),
            name=data.get("name"),
            state=data.get("state", ""),
            description=data.get("description", ""),
            url=data.get("url"),
            created_on=data.get("created_on"),
            updated_on=data.get("updated_on"),
        )


# ==================== BRANCH RESTRICTIONS ====================


class BranchRestriction(BaseModel):
    """Branch restriction info."""

    id: int
    kind: str
    pattern: str = ""
    branch_match_kind: Optional[str] = None
    branch_type: Optional[str] = None
    value: Optional[int] = None
    users: list[str] = []
    groups: list[str] = []

    @classmethod
    def from_api(cls, data: dict) -> "BranchRestriction":
        return cls(
            id=data.get("id", 0),
            kind=data.get("kind", ""),
            pattern=data.get("pattern", ""),
            branch_match_kind=data.get("branch_match_kind"),
            branch_type=data.get("branch_type"),
            value=data.get("value"),
            users=[u.get("display_name", "") for u in data.get("users", [])],
            groups=[g.get("name", "") for g in data.get("groups", [])],
        )


# ==================== PERMISSIONS ====================


class UserPermission(BaseModel):
    """User permission info."""

    user: Optional[str] = None
    account_id: Optional[str] = None
    permission: str

    @classmethod
    def from_api(cls, data: dict) -> "UserPermission":
        user_data = data.get("user") or {}
        return cls(
            user=user_data.get("display_name"),
            account_id=user_data.get("account_id"),
            permission=data.get("permission", ""),
        )


class GroupPermission(BaseModel):
    """Group permission info."""

    group: Optional[str] = None
    slug: Optional[str] = None
    permission: str

    @classmethod
    def from_api(cls, data: dict) -> "GroupPermission":
        group_data = data.get("group") or {}
        return cls(
            group=group_data.get("name"),
            slug=group_data.get("slug"),
            permission=data.get("permission", ""),
        )


# ==================== FILE/DIRECTORY ====================


class DirectoryEntry(BaseModel):
    """Directory entry info."""

    path: str
    type: str  # "commit_file" or "commit_directory"
    size: Optional[int] = None

    @classmethod
    def from_api(cls, data: dict) -> "DirectoryEntry":
        return cls(
            path=data.get("path", ""),
            type=data.get("type", ""),
            size=data.get("size"),
        )
