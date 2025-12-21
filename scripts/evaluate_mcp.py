#!/usr/bin/env python3
"""
MCP Server Evaluation Script for Bitbucket MCP

This script tests both Python and TypeScript implementations of the Bitbucket MCP server
to verify they expose the same tools and produce equivalent results.

IMPORTANT: Only read-only operations are executed to avoid destructive actions.

Usage:
    # Set required environment variables first
    export BITBUCKET_WORKSPACE=your-workspace
    export BITBUCKET_EMAIL=your-email@example.com
    export BITBUCKET_API_TOKEN=your-api-token

    # Run the evaluation
    python scripts/evaluate_mcp.py
    
    # Or run only TypeScript version
    python scripts/evaluate_mcp.py --ts-only
"""

import json
import subprocess
import sys
import os
import argparse
from typing import Any, Optional
from dataclasses import dataclass, field
from pathlib import Path

# MCP JSON-RPC message IDs
_message_id = 0

def next_id() -> int:
    global _message_id
    _message_id += 1
    return _message_id


@dataclass
class MCPServer:
    """Manages an MCP server subprocess"""
    name: str
    command: list[str]
    env: dict[str, str]
    process: Optional[subprocess.Popen] = None
    
    def start(self) -> None:
        """Start the MCP server process"""
        full_env = {**os.environ, **self.env}
        self.process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=full_env,
            text=True,
            bufsize=1,
        )
        # Send initialize request
        self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "evaluate_mcp", "version": "1.0.0"}
        })
        # Send initialized notification
        self._send_notification("notifications/initialized", {})
    
    def stop(self) -> None:
        """Stop the MCP server process"""
        if self.process:
            self.process.terminate()
            self.process.wait(timeout=5)
    
    def _send_request(self, method: str, params: dict) -> dict:
        """Send a JSON-RPC request and wait for response"""
        if not self.process or not self.process.stdin or not self.process.stdout:
            raise RuntimeError(f"Server {self.name} not started")
        
        msg_id = next_id()
        request = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params
        }
        
        # Send request
        request_line = json.dumps(request) + "\n"
        self.process.stdin.write(request_line)
        self.process.stdin.flush()
        
        # Read response (may need to skip notifications)
        while True:
            response_line = self.process.stdout.readline()
            if not response_line:
                stderr = self.process.stderr.read() if self.process.stderr else ""
                raise RuntimeError(f"Server {self.name} closed unexpectedly: {stderr}")
            
            try:
                response = json.loads(response_line)
                # Skip notifications (no id field)
                if "id" in response:
                    return response
            except json.JSONDecodeError as e:
                print(f"[{self.name}] Invalid JSON: {response_line[:100]}...", file=sys.stderr)
                continue
    
    def _send_notification(self, method: str, params: dict) -> None:
        """Send a JSON-RPC notification (no response expected)"""
        if not self.process or not self.process.stdin:
            raise RuntimeError(f"Server {self.name} not started")
        
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        notification_line = json.dumps(notification) + "\n"
        self.process.stdin.write(notification_line)
        self.process.stdin.flush()
    
    def list_tools(self) -> list[dict]:
        """Get list of available tools"""
        response = self._send_request("tools/list", {})
        if "error" in response:
            raise RuntimeError(f"Error listing tools: {response['error']}")
        return response.get("result", {}).get("tools", [])
    
    def call_tool(self, name: str, arguments: dict) -> dict:
        """Call a tool and return the result"""
        response = self._send_request("tools/call", {
            "name": name,
            "arguments": arguments
        })
        if "error" in response:
            return {"error": response["error"]}
        
        result = response.get("result", {})
        # Extract text content from MCP response format
        contents = result.get("content", [])
        if contents and len(contents) > 0:
            text = contents[0].get("text", "{}")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"raw": text}
        return result


@dataclass
class TestResult:
    """Result of a single tool test"""
    tool_name: str
    success: bool
    python_result: Optional[dict] = None
    typescript_result: Optional[dict] = None
    error: Optional[str] = None
    differences: list[str] = field(default_factory=list)


def compare_results(py_result: dict, ts_result: dict, ignore_keys: set[str] = None) -> list[str]:
    """Compare two result dictionaries and return list of differences"""
    if ignore_keys is None:
        ignore_keys = {"updated", "created", "created_on", "updated_on", "date", "timestamp"}
    
    differences = []
    
    # Check for errors
    if "error" in py_result and "error" not in ts_result:
        differences.append(f"Python returned error, TypeScript did not")
    elif "error" not in py_result and "error" in ts_result:
        differences.append(f"TypeScript returned error, Python did not")
    elif "error" in py_result and "error" in ts_result:
        return []  # Both errored, consider this a match
    
    # Compare top-level keys
    py_keys = set(py_result.keys()) - ignore_keys
    ts_keys = set(ts_result.keys()) - ignore_keys
    
    if py_keys != ts_keys:
        missing_in_ts = py_keys - ts_keys
        missing_in_py = ts_keys - py_keys
        if missing_in_ts:
            differences.append(f"Keys missing in TypeScript: {missing_in_ts}")
        if missing_in_py:
            differences.append(f"Keys missing in Python: {missing_in_py}")
    
    # Compare common keys
    for key in py_keys & ts_keys:
        py_val = py_result[key]
        ts_val = ts_result[key]
        
        # For arrays, compare length and structure
        if isinstance(py_val, list) and isinstance(ts_val, list):
            if len(py_val) != len(ts_val):
                differences.append(f"Array '{key}' length differs: Python={len(py_val)}, TypeScript={len(ts_val)}")
        elif type(py_val) != type(ts_val):
            differences.append(f"Type mismatch for '{key}': Python={type(py_val).__name__}, TypeScript={type(ts_val).__name__}")
    
    return differences


# Safe read-only tools to test (no create, delete, merge, trigger operations)
SAFE_TOOLS = [
    ("list_projects", {}),
    ("list_repositories", {"limit": 3}),
    # The following need a repo_slug - will be set dynamically
]

SAFE_TOOLS_WITH_REPO = [
    ("list_branches", {"limit": 5}),
    ("list_pull_requests", {"state": "OPEN", "limit": 3}),
    ("list_pipelines", {"limit": 3}),
    ("list_commits", {"limit": 5}),
    ("list_tags", {"limit": 5}),
    ("list_webhooks", {"limit": 5}),
    ("list_environments", {"limit": 5}),
]


def run_evaluation(
    python_cmd: list[str],
    typescript_cmd: list[str],
    env: dict[str, str],
    test_repo: Optional[str] = None,
    ts_only: bool = False,
) -> list[TestResult]:
    """Run the evaluation comparing Python and TypeScript MCP servers"""
    
    results: list[TestResult] = []
    
    # Start servers
    ts_server = MCPServer("TypeScript", typescript_cmd, env)
    py_server = MCPServer("Python", python_cmd, env) if not ts_only else None
    
    try:
        print("Starting MCP servers...")
        ts_server.start()
        print(f"  ✓ TypeScript server started")
        
        if py_server:
            py_server.start()
            print(f"  ✓ Python server started")
        
        # List and compare tools
        print("\n--- Tool Listing ---")
        ts_tools = ts_server.list_tools()
        ts_tool_names = {t["name"] for t in ts_tools}
        print(f"TypeScript: {len(ts_tools)} tools")
        
        if py_server:
            py_tools = py_server.list_tools()
            py_tool_names = {t["name"] for t in py_tools}
            print(f"Python: {len(py_tools)} tools")
            
            missing_in_ts = py_tool_names - ts_tool_names
            missing_in_py = ts_tool_names - py_tool_names
            
            if missing_in_ts:
                print(f"  ⚠ Missing in TypeScript: {missing_in_ts}")
            if missing_in_py:
                print(f"  ⚠ Missing in Python: {missing_in_py}")
            if not missing_in_ts and not missing_in_py:
                print(f"  ✓ Tool sets match!")
        
        # Get a test repo if not provided
        if not test_repo:
            print("\n--- Finding test repository ---")
            ts_repos = ts_server.call_tool("list_repositories", {"limit": 1})
            repos = ts_repos.get("repositories", [])
            if repos:
                test_repo = repos[0].get("name")
                print(f"  Using repository: {test_repo}")
            else:
                print("  ⚠ No repositories found, skipping repo-specific tests")
        
        # Test safe tools
        print("\n--- Testing Read-Only Tools ---")
        
        for tool_name, args in SAFE_TOOLS:
            print(f"\nTesting: {tool_name}")
            result = TestResult(tool_name=tool_name, success=True)
            
            try:
                ts_result = ts_server.call_tool(tool_name, args)
                result.typescript_result = ts_result
                
                if "error" in ts_result:
                    print(f"  TypeScript: ⚠ {ts_result['error']}")
                else:
                    print(f"  TypeScript: ✓")
                
                if py_server:
                    py_result = py_server.call_tool(tool_name, args)
                    result.python_result = py_result
                    
                    if "error" in py_result:
                        print(f"  Python: ⚠ {py_result['error']}")
                    else:
                        print(f"  Python: ✓")
                    
                    # Compare results
                    differences = compare_results(py_result, ts_result)
                    result.differences = differences
                    if differences:
                        print(f"  Differences: {differences}")
                        result.success = False
                    else:
                        print(f"  ✓ Results match")
                
            except Exception as e:
                result.success = False
                result.error = str(e)
                print(f"  ✗ Error: {e}")
            
            results.append(result)
        
        # Test repo-specific tools
        if test_repo:
            for tool_name, base_args in SAFE_TOOLS_WITH_REPO:
                args = {"repo_slug": test_repo, **base_args}
                print(f"\nTesting: {tool_name} (repo={test_repo})")
                result = TestResult(tool_name=tool_name, success=True)
                
                try:
                    ts_result = ts_server.call_tool(tool_name, args)
                    result.typescript_result = ts_result
                    
                    if "error" in ts_result:
                        print(f"  TypeScript: ⚠ {ts_result.get('error', ts_result)}")
                    else:
                        print(f"  TypeScript: ✓")
                    
                    if py_server:
                        py_result = py_server.call_tool(tool_name, args)
                        result.python_result = py_result
                        
                        if "error" in py_result:
                            print(f"  Python: ⚠ {py_result.get('error', py_result)}")
                        else:
                            print(f"  Python: ✓")
                        
                        differences = compare_results(py_result, ts_result)
                        result.differences = differences
                        if differences:
                            print(f"  Differences: {differences}")
                            result.success = False
                        else:
                            print(f"  ✓ Results match")
                    
                except Exception as e:
                    result.success = False
                    result.error = str(e)
                    print(f"  ✗ Error: {e}")
                
                results.append(result)
        
    finally:
        print("\n--- Stopping servers ---")
        ts_server.stop()
        print(f"  ✓ TypeScript server stopped")
        if py_server:
            py_server.stop()
            print(f"  ✓ Python server stopped")
    
    return results


def print_summary(results: list[TestResult]) -> bool:
    """Print summary and return True if all tests passed"""
    print("\n" + "=" * 60)
    print("EVALUATION SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for r in results if r.success)
    failed = len(results) - passed
    
    print(f"\nTotal tests: {len(results)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    
    if failed > 0:
        print("\nFailed tests:")
        for r in results:
            if not r.success:
                print(f"  - {r.tool_name}")
                if r.error:
                    print(f"    Error: {r.error}")
                if r.differences:
                    for d in r.differences:
                        print(f"    Diff: {d}")
    
    return failed == 0


def main():
    parser = argparse.ArgumentParser(description="Evaluate Bitbucket MCP servers")
    parser.add_argument("--ts-only", action="store_true", help="Only test TypeScript version")
    parser.add_argument("--repo", help="Repository slug to test with")
    args = parser.parse_args()
    
    # Check required environment variables
    required_vars = ["BITBUCKET_WORKSPACE", "BITBUCKET_EMAIL", "BITBUCKET_API_TOKEN"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        print(f"Error: Missing required environment variables: {missing}")
        print("\nSet them with:")
        print("  export BITBUCKET_WORKSPACE=your-workspace")
        print("  export BITBUCKET_EMAIL=your-email@example.com")
        print("  export BITBUCKET_API_TOKEN=your-api-token")
        sys.exit(1)
    
    # Build environment for MCP servers
    env = {
        "BITBUCKET_WORKSPACE": os.environ["BITBUCKET_WORKSPACE"],
        "BITBUCKET_EMAIL": os.environ["BITBUCKET_EMAIL"],
        "BITBUCKET_API_TOKEN": os.environ["BITBUCKET_API_TOKEN"],
    }
    
    # Determine paths
    script_dir = Path(__file__).parent.parent
    ts_dist = script_dir / "typescript" / "dist" / "index.js"
    
    if not ts_dist.exists():
        print(f"Error: TypeScript build not found at {ts_dist}")
        print("Run: cd typescript && npm run build")
        sys.exit(1)
    
    # Commands to start servers
    typescript_cmd = ["node", str(ts_dist)]
    python_cmd = ["uv", "run", "python", "-m", "src.server"]
    
    print("=" * 60)
    print("BITBUCKET MCP EVALUATION")
    print("=" * 60)
    print(f"\nWorkspace: {env['BITBUCKET_WORKSPACE']}")
    print(f"TypeScript: {ts_dist}")
    if not args.ts_only:
        print(f"Python: {script_dir / 'python'}")
    
    # Change to python directory for Python server
    original_cwd = os.getcwd()
    os.chdir(script_dir / "python")
    
    try:
        results = run_evaluation(
            python_cmd=python_cmd,
            typescript_cmd=typescript_cmd,
            env=env,
            test_repo=args.repo,
            ts_only=args.ts_only,
        )
        
        success = print_summary(results)
        sys.exit(0 if success else 1)
    finally:
        os.chdir(original_cwd)


if __name__ == "__main__":
    main()

