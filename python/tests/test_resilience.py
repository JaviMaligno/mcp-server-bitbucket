"""SPEC-4: bounded recovery without replaying ambiguous writes."""
import httpx
import pytest
import respx

from src.bitbucket_client import BitbucketClient, BitbucketError

URL = "https://api.bitbucket.org/2.0/repositories/test-workspace/repo"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr("src.bitbucket_client.time.sleep", lambda _: None)
    with BitbucketClient(max_retries=2) as client:
        yield client


@pytest.mark.parametrize("text", [False, True])
@pytest.mark.parametrize("failure", [httpx.ReadTimeout("timeout"), httpx.RemoteProtocolError("closed"), 503])
@respx.mock
def test_spec4_read_recovers(client, text, failure):
    responses = [failure if isinstance(failure, Exception) else httpx.Response(failure),
                 httpx.Response(200, text="ok") if text else httpx.Response(200, json={"ok": True})]
    route = respx.get(URL).mock(side_effect=responses)
    result = client._request_text("repositories/test-workspace/repo") if text else client.get_repository("repo")
    assert result == ("ok" if text else {"ok": True})
    assert route.call_count == 2


@respx.mock
def test_spec4_write_not_replayed_after_timeout(client):
    route = respx.post(URL).mock(side_effect=httpx.ReadTimeout("ambiguous"))
    with pytest.raises(BitbucketError, match="Network"):
        client._request("POST", "repositories/test-workspace/repo", json={})
    assert route.call_count == 1


@pytest.mark.parametrize("header", ["bogus", "-2", "nan", "inf"])
@respx.mock
def test_spec4_malformed_retry_after_uses_backoff(client, header):
    route = respx.get(URL).mock(side_effect=[httpx.Response(429, headers={"Retry-After": header}), httpx.Response(200, json={})])
    assert client.get_repository("repo") == {}
    assert route.call_count == 2


@respx.mock
def test_spec4_long_retry_after_fails_fast(client):
    route = respx.get(URL).respond(429, headers={"Retry-After": "3600"})
    with pytest.raises(BitbucketError, match="budget"):
        client.get_repository("repo")
    assert route.call_count == 1


@respx.mock
def test_spec4_exhaustion_then_next_call_works(client):
    route = respx.get(URL).mock(side_effect=[httpx.ConnectError("offline")] * 3 + [httpx.Response(200, json={"ok": True})])
    with pytest.raises(BitbucketError, match="Network"):
        client.get_repository("repo")
    assert client.get_repository("repo") == {"ok": True}
    assert route.call_count == 4


@respx.mock
def test_spec4_elapsed_deadline_prevents_another_attempt(client, monkeypatch):
    ticks = iter([0.0, 0.0, 31.0])
    monkeypatch.setattr("src.bitbucket_client.time.monotonic", lambda: next(ticks, 31.0))
    route = respx.get(URL).respond(503)
    with pytest.raises(BitbucketError, match="budget"):
        client.get_repository("repo")
    assert route.call_count == 1


@respx.mock
def test_spec4_5xx_write_not_replayed(client):
    route = respx.post(URL).respond(503)
    with pytest.raises(BitbucketError, match="503"):
        client._request("POST", "repositories/test-workspace/repo")
    assert route.call_count == 1


def test_spec4_http_date_retry_after():
    from datetime import datetime, timezone, timedelta
    from email.utils import format_datetime
    value = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=10))
    assert 8 <= BitbucketClient._retry_delay(value, 1) <= 10
