import asyncio
import os
import sys
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ROOT = Path(__file__).resolve().parents[2]


def test_stdio_mcp_protocol_lists_and_calls_tools():
    handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    handle.close()

    async def exercise_server():
        environment = os.environ.copy()
        environment["IDEAMINER_DB"] = handle.name
        parameters = StdioServerParameters(
            command=sys.executable,
            args=[str(ROOT / "ideaminer_mcp.py")],
            env=environment,
        )
        async with stdio_client(parameters) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = {tool.name for tool in tools.tools}
                assert {"search_ideas", "create_idea", "update_idea", "open_ideaminer", "create_codex_checkpoint"} <= names
                result = await session.call_tool("list_projects", arguments={})
                assert result.isError is False
                assert result.structuredContent["projects"][0]["name"] == "random_chat"

    try:
        asyncio.run(exercise_server())
    finally:
        try:
            os.unlink(handle.name)
        except PermissionError:
            pass
