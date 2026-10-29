"""SPEC-2/3: complete, resumable history and Git comparison semantics."""
import httpx
import pytest
import respx

from src.bitbucket_client import BitbucketClient, BitbucketError

ROOT = "https://api.bitbucket.org/2.0/repositories/test-workspace/repo"


@pytest.fixture
def client():
    with BitbucketClient() as client:
        yield client


@respx.mock
def test_spec2_cursor_reaches_old_commits(client):
    next_url = ROOT + "/commits?cursor=old"
    first = respx.get(ROOT + "/commits", params={"pagelen": 1}).respond(
        200, json={"values": [{"hash": "new"}], "next": next_url})
    second = respx.get(next_url).respond(200, json={"values": [{"hash": "old"}]})
    page = client.list_commits_page("repo", limit=1)
    assert page["has_more"] is True
    assert first.called
    page = client.list_commits_page("repo", cursor=page["next_cursor"])
    assert page == {"values": [{"hash": "old"}], "has_more": False, "next_cursor": None}
    assert second.called


@pytest.mark.parametrize("cursor", [
    "https://evil.example/commits", "http://api.bitbucket.org/2.0/repositories/test-workspace/repo/commits",
    ROOT + "/refs/tags?page=2", ROOT.replace("https://", "https://user:pass@") + "/commits",
    ROOT + "/commits#fragment", ROOT.replace("api.bitbucket.org", "api.bitbucket.org:444") + "/commits",
])
@respx.mock
def test_spec2_rejects_cursor_outside_endpoint(client, cursor):
    with pytest.raises(BitbucketError, match="cursor"):
        client.list_commits_page("repo", cursor=cursor)
    assert len(respx.calls) == 0


@respx.mock
def test_spec2_existing_list_follows_next_without_losing_results(client):
    respx.get(ROOT + "/commits", params={"pagelen": 3}).respond(
        200, json={"values": [{"hash": "a"}], "next": ROOT + "/commits?page=2"})
    respx.get(ROOT + "/commits?page=2").respond(
        200, json={"values": [{"hash": "b"}, {"hash": "c"}, {"hash": "d"}]})
    assert [c["hash"] for c in client.list_commits("repo", limit=3)] == ["a", "b", "c"]


@respx.mock
def test_spec3_revision_filters_and_path(client):
    route = respx.get(ROOT + "/commits").respond(200, json={"values": []})
    client.list_commits_page("repo", include=["release/v2", "other"], exclude=["v1"], path="src/a.py")
    params = route.calls.last.request.url.params
    assert params.get_list("include") == ["release/v2", "other"]
    assert params.get_list("exclude") == ["v1"]
    assert params["path"] == "src/a.py"


@respx.mock
def test_spec3_compare_is_base_to_head_and_paginated(client):
    respx.get(ROOT + "/commit/head").respond(200, json={"hash": "b" * 40})
    respx.get(ROOT + "/commit/base").respond(200, json={"hash": "a" * 40})
    route = respx.get(ROOT + "/diffstat/" + "b" * 12 + ".." + "a" * 12).respond(
        200, json={"values": [{"status": "added"}], "next": ROOT + "/diffstat/" + "b" * 12 + ".." + "a" * 12 + "?page=2"})
    result = client.compare_commits_page("repo", "base", "head", path="new.py")
    assert result["has_more"]
    assert route.calls.last.request.url.params["topic"] == "false"
    assert route.calls.last.request.url.params["path"] == "new.py"


@pytest.mark.parametrize("head,base", [("b" * 7, "release/v1"), ("b" * 40, "a" * 40)])
@respx.mock
def test_spec2_real_bitbucket_comparison_cursor_normalization(client, head, base):
    respx.get(ROOT + "/commit/" + "b" * 7).respond(200, json={"hash": "b" * 40})
    respx.get(ROOT + "/commit/release%2Fv1").respond(200, json={"hash": "a" * 40})
    respx.get(ROOT + "/commit/" + "b" * 40).respond(200, json={"hash": "b" * 40})
    respx.get(ROOT + "/commit/" + "a" * 40).respond(200, json={"hash": "a" * 40})
    endpoint = ROOT + "/diffstat/" + "b" * 12 + ".." + "a" * 12
    first = respx.get(endpoint, params={"pagelen": 1, "topic": "false"}).respond(
        200, json={"values": [{"status": "added"}], "next": endpoint + "?page=2"})
    second = respx.get(endpoint + "?page=2").respond(200, json={"values": [{"status": "removed"}]})
    page = client.compare_commits_page("repo", base, head, limit=1)
    assert first.called
    page = client.compare_commits_page("repo", base, head, cursor=page["next_cursor"])
    assert second.called and page["has_more"] is False


@respx.mock
def test_spec3_invalid_full_hash_is_not_silently_shortened(client):
    invalid = "a" * 12 + "b" * 28
    respx.get(ROOT + "/commit/" + invalid).respond(404)
    with pytest.raises(BitbucketError, match="revision not found"):
        client.compare_commits_page("repo", "base", invalid)
    assert len(respx.calls) == 1


@respx.mock
def test_spec3_hex_named_ref_resolves_its_real_target(client):
    respx.get(ROOT + "/commit/" + "a" * 12).respond(200, json={"hash": "b" * 40})
    assert client._comparison_ref("repo", "a" * 12) == "b" * 12


def test_spec3_file_history_keeps_full_hash_without_inventing_metadata(mocker):
    from src import server
    client = mocker.patch.object(server, "get_client").return_value
    client.get_file_history.return_value = {"values": [{"path": "old.py", "commit": {"hash": "a" * 40}}],
                                            "has_more": False, "next_cursor": None}
    assert server.get_file_history("repo", "new.py")["history"] == [
        {"path": "old.py", "commit": {"hash": "a" * 40}}]


@respx.mock
def test_spec3_diff_tag_merge_base_filehistory(client):
    diff = respx.get(ROOT + "/diff/head..base").respond(200, text="+new\n-old\n")
    assert client.get_commit_diff("repo", "base", "head", path="a.py") == "+new\n-old\n"
    assert diff.calls.last.request.url.params["topic"] == "false"
    respx.get(ROOT + "/merge-base/head..base").respond(200, json={"hash": "ancestor"})
    assert client.get_merge_base("repo", "base", "head")["hash"] == "ancestor"
    tag = respx.get(ROOT + "/refs/tags/release%2Fv1").respond(200, json={"name": "release/v1"})
    assert client.get_tag("repo", "release/v1")["name"] == "release/v1"
    assert "%2F" in str(tag.calls.last.request.url)
    respx.get(ROOT + "/filehistory/main/src/a.py").respond(200, json={"values": []})
    assert client.get_file_history("repo", "src/a.py", "main")["has_more"] is False


@respx.mock
def test_spec3_missing_diff_returns_none(client):
    respx.get(ROOT + "/diff/head..base").respond(404)
    assert client.get_commit_diff("repo", "base", "head") is None


@respx.mock
def test_spec2_cursor_preserves_complete_original_page(client):
    cursor = ROOT + "/commits?pagelen=100&page=2"
    respx.get(cursor).respond(200, json={"values": [{"hash": str(i)} for i in range(100)]})
    assert len(client.list_commits_page("repo", limit=1, cursor=cursor)["values"]) == 100


@respx.mock
def test_spec2_repeated_legacy_cursor_fails(client):
    cursor = ROOT + "/commits?page=2"
    respx.get(ROOT + "/commits").respond(200, json={"values": [], "next": cursor})
    with pytest.raises(BitbucketError, match="Repeated"):
        client.list_commits("repo")


@respx.mock
def test_spec2_distinct_empty_pages_are_bounded(client, monkeypatch):
    monkeypatch.setattr(client, "MAX_PAGES", 2)
    respx.get(ROOT + "/commits").mock(side_effect=[
        httpx.Response(200, json={"values": [], "next": ROOT + "/commits?page=2"}),
        httpx.Response(200, json={"values": [], "next": ROOT + "/commits?page=3"})])
    with pytest.raises(BitbucketError, match="page budget"):
        client.list_commits("repo")
    assert len(respx.calls) == 2


def test_spec3_tools_preserve_more_than_50_files_and_deleted_path(mocker):
    from src import server
    client = mocker.patch.object(server, "get_client").return_value
    files = [{"new": None, "old": {"path": f"deleted-{i}"}, "status": "removed"} for i in range(80)]
    client.compare_commits_page.return_value = {"values": files, "has_more": True, "next_cursor": "next"}
    result = server.compare_commits("repo", "base", "head", limit=100)
    assert len(result["files"]) == 80
    assert result["files"][0]["path"] == "deleted-0"
    assert result["next_cursor"] == "next"


def test_spec3_diff_chunks_can_reconstruct_entire_unicode_diff(mocker):
    from src import server
    client = mocker.patch.object(server, "get_client").return_value
    text = "+new 😀\n-old\n" * 20
    client.get_commit_diff.return_value = text
    chunks = []
    offset = 0
    while True:
        result = server.get_commit_diff("repo", "base", "head", offset=offset, max_chars=17)
        chunks.append(result["diff"])
        if not result["truncated"]:
            assert result["next_offset"] is None
            break
        offset = result["next_offset"]
    assert "".join(chunks) == text


def test_spec4_tool_error_then_success_is_normalized(mocker):
    from src import server
    client = mocker.patch.object(server, "get_client").return_value
    client.list_commits_page.side_effect = [BitbucketError("Network unavailable"),
        {"values": [], "has_more": False, "next_cursor": None}]
    assert server.list_commits("repo")["success"] is False
    assert server.list_commits("repo")["commits"] == []
