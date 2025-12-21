#!/usr/bin/env python3
"""
Quick test to verify MCP server can start and list tools.
This doesn't require any credentials - it just tests that the server binary works.
"""

import json
import subprocess
import sys
from pathlib import Path

def test_server_startup(name: str, command: list[str], expect_config_error: bool = False) -> bool:
    """Test that a server can start and respond to initialize"""
    print(f"\nTesting {name} server startup...")
    
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        
        # Send initialize request
        init_request = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1.0.0"}
            }
        }) + "\n"
        
        process.stdin.write(init_request)
        process.stdin.flush()
        
        # Read response with timeout
        import select
        if select.select([process.stdout], [], [], 5)[0]:
            response_line = process.stdout.readline()
            response = json.loads(response_line)
            
            if "error" in response:
                if expect_config_error:
                    print(f"  ✓ Server responded with expected config error")
                    process.terminate()
                    return True
                else:
                    print(f"  ✗ Error: {response['error']}")
                    process.terminate()
                    return False
            
            if "result" in response:
                result = response["result"]
                print(f"  ✓ Server initialized successfully")
                print(f"    Server: {result.get('serverInfo', {}).get('name', 'unknown')}")
                print(f"    Version: {result.get('serverInfo', {}).get('version', 'unknown')}")
                
                # Send tools/list
                process.stdin.write(json.dumps({
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                    "params": {}
                }) + "\n")
                process.stdin.flush()
                
                process.stdin.write(json.dumps({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {}
                }) + "\n")
                process.stdin.flush()
                
                if select.select([process.stdout], [], [], 5)[0]:
                    tools_response = json.loads(process.stdout.readline())
                    if "result" in tools_response:
                        tools = tools_response["result"].get("tools", [])
                        print(f"  ✓ Listed {len(tools)} tools")
                        process.terminate()
                        return True
                
                process.terminate()
                return True
        else:
            stderr = process.stderr.read()
            if expect_config_error and "Configuration error" in stderr:
                print(f"  ✓ Server exited with expected config error")
                return True
            print(f"  ✗ No response (timeout)")
            print(f"  stderr: {stderr[:500]}")
            process.terminate()
            return False
            
    except Exception as e:
        print(f"  ✗ Exception: {e}")
        return False
    finally:
        try:
            process.terminate()
            process.wait(timeout=2)
        except:
            pass

def main():
    script_dir = Path(__file__).parent.parent
    
    # Test Bitbucket TypeScript
    ts_bitbucket = script_dir / "typescript" / "dist" / "index.js"
    if ts_bitbucket.exists():
        # This will fail with config error since no credentials, but server should start
        result = test_server_startup(
            "Bitbucket TypeScript",
            ["node", str(ts_bitbucket)],
            expect_config_error=True
        )
        if not result:
            sys.exit(1)
    else:
        print(f"Bitbucket TypeScript not found at {ts_bitbucket}")
        sys.exit(1)
    
    print("\n✓ All startup tests passed!")

if __name__ == "__main__":
    main()

