"""SPEC-1/4/5: real stdio MCP session survives exhausted HTTP retries."""
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def test_spec4_stdio_survives_network_failure():
    # Inject the fake at the HTTP transport boundary in a child process. The
    # client, tools, serialization and MCP transport are production code.
    launcher = """
import httpx
import src.bitbucket_client as module
from src.server import main
calls = 0
def respond(request):
    global calls
    calls += 1
    if calls <= 2:
        raise httpx.ReadTimeout('synthetic timeout')
    return httpx.Response(200, json={'values': [{'hash': 'abc123', 'message': 'ok'}]})
module.time.sleep = lambda _: None
client = module.get_client()
client._client = httpx.Client(transport=httpx.MockTransport(respond))
main()
"""

    async def run():
        env = {**os.environ, "BITBUCKET_WORKSPACE": "synthetic", "BITBUCKET_EMAIL": "test@example.com",
               "BITBUCKET_API_TOKEN": "synthetic-no-provider-call", "BITBUCKET_AUTH_TYPE": "basic",
               "MAX_RETRIES": "1", "OUTPUT_FORMAT": "json"}
        env.pop("BITBUCKET_OAUTH_TOKEN", None)
        params = StdioServerParameters(command=sys.executable, args=["-c", launcher],
                                       env=env, cwd=str(Path(__file__).resolve().parents[1]))
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                names = {tool.name for tool in (await session.list_tools()).tools}
                assert {"get_tag", "get_commit_diff", "get_file_history", "get_merge_base"} <= names
                failure = await session.call_tool("list_commits", {"repo_slug": "repo"})
                failed = json.loads(failure.content[0].text)
                assert failed["success"] is False
                assert "Network" in failed["error"]
                success = await session.call_tool("list_commits", {"repo_slug": "repo"})
                result = json.loads(success.content[0].text)
                assert not success.isError
                assert result["commits"][0]["hash"] == "abc123"
                assert result["has_more"] is False

    asyncio.run(asyncio.wait_for(run(), timeout=20))
