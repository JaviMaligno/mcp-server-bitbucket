"""Tests for src/server.py validation functions."""

import os

import pytest

from src.server import validate_limit
from src.settings import CommitStatusState, MergeStrategy, PRState, Settings, clear_settings_cache


class TestValidateLimit:
    """Tests for validate_limit function."""

    def test_valid_limit_within_range(self):
        """Valid limit within range should be returned unchanged."""
        assert validate_limit(50) == 50
        assert validate_limit(1) == 1
        assert validate_limit(100) == 100

    def test_limit_below_minimum(self):
        """Limit below 1 should be clamped to 1."""
        assert validate_limit(0) == 1
        assert validate_limit(-1) == 1
        assert validate_limit(-100) == 1

    def test_limit_above_maximum(self):
        """Limit above max should be clamped to max."""
        assert validate_limit(101) == 100
        assert validate_limit(1000) == 100
        assert validate_limit(999999) == 100

    def test_custom_max_limit(self):
        """Custom max_limit should be respected."""
        assert validate_limit(50, max_limit=25) == 25
        assert validate_limit(10, max_limit=25) == 10
        assert validate_limit(0, max_limit=25) == 1


class TestPRStateEnum:
    """Tests for PRState enum validation."""

    def test_valid_states(self):
        """Valid PR states should be accepted."""
        assert PRState("OPEN").value == "OPEN"
        assert PRState("MERGED").value == "MERGED"
        assert PRState("DECLINED").value == "DECLINED"
        assert PRState("SUPERSEDED").value == "SUPERSEDED"

    def test_invalid_state_raises(self):
        """Invalid PR state should raise ValueError."""
        with pytest.raises(ValueError):
            PRState("INVALID")

    def test_case_sensitivity(self):
        """PR state should be case sensitive."""
        with pytest.raises(ValueError):
            PRState("open")


class TestMergeStrategyEnum:
    """Tests for MergeStrategy enum validation."""

    def test_valid_strategies(self):
        """Valid merge strategies should be accepted."""
        assert MergeStrategy("merge_commit").value == "merge_commit"
        assert MergeStrategy("squash").value == "squash"
        assert MergeStrategy("fast_forward").value == "fast_forward"

    def test_invalid_strategy_raises(self):
        """Invalid merge strategy should raise ValueError."""
        with pytest.raises(ValueError):
            MergeStrategy("invalid")

    def test_case_sensitivity(self):
        """Merge strategy should be case sensitive."""
        with pytest.raises(ValueError):
            MergeStrategy("MERGE_COMMIT")


class TestCommitStatusStateEnum:
    """Tests for CommitStatusState enum validation."""

    def test_valid_states(self):
        """Valid commit status states should be accepted."""
        assert CommitStatusState("SUCCESSFUL").value == "SUCCESSFUL"
        assert CommitStatusState("FAILED").value == "FAILED"
        assert CommitStatusState("INPROGRESS").value == "INPROGRESS"
        assert CommitStatusState("STOPPED").value == "STOPPED"

    def test_invalid_state_raises(self):
        """Invalid commit status state should raise ValueError."""
        with pytest.raises(ValueError):
            CommitStatusState("INVALID")

    def test_case_sensitivity(self):
        """Commit status state should be case sensitive."""
        with pytest.raises(ValueError):
            CommitStatusState("successful")


class TestSettingsValidation:
    """Tests for Settings validation."""

    def test_api_timeout_default(self):
        """Default API timeout should be 30 seconds."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
        )
        assert settings.api_timeout == 30

    def test_api_timeout_custom(self):
        """Custom API timeout should be accepted."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
            api_timeout=60,
        )
        assert settings.api_timeout == 60

    def test_api_timeout_clamped_max(self):
        """API timeout should be clamped to 300 max."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
            api_timeout=500,
        )
        assert settings.api_timeout == 300

    def test_api_timeout_clamped_min(self):
        """API timeout should be clamped to 1 min."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
            api_timeout=0,
        )
        assert settings.api_timeout == 1

    def test_max_retries_default(self):
        """Default max retries should be 3."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
        )
        assert settings.max_retries == 3

    def test_max_retries_clamped_max(self):
        """Max retries should be clamped to 10."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
            max_retries=20,
        )
        assert settings.max_retries == 10

    def test_max_retries_clamped_min(self):
        """Max retries should be clamped to 0 minimum."""
        settings = Settings(
            bitbucket_workspace="test",
            bitbucket_email="test@example.com",
            bitbucket_api_token="token",
            max_retries=-5,
        )
        assert settings.max_retries == 0
