import asyncio
import json
import logging
import os
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

CLAUDE_CMD = os.environ.get("CLAUDE_CMD", "claude")


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    workspace_path: str | None = None


def _build_prompt(messages: list[Message]) -> str:
    history = messages[:-1]
    parts = []
    if history:
        lines = []
        for m in history:
            lines.append(f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}")
        parts.append("Conversation so far:\n" + "\n\n".join(lines))
    parts.append(messages[-1].content if messages else "")
    return "\n\n".join(parts)


async def _stream_claude(prompt: str, cwd: str) -> AsyncIterator[str]:
    logger.info("chat: spawning claude cwd=%s", cwd)
    proc = await asyncio.create_subprocess_exec(
        CLAUDE_CMD,
        "--print",
        "--output-format", "stream-json",
        "--verbose",
        prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        cwd=cwd,
    )

    assert proc.stdout
    async for raw in proc.stdout:
        line = raw.decode().strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "text" and block.get("text"):
                    yield f"data: {json.dumps({'text': block['text']})}\n\n"
                elif block.get("type") == "tool_use":
                    name = block.get("name", "tool")
                    inp = block.get("input", {})
                    logger.info("chat: tool=%s", name)
                    yield f"data: {json.dumps({'tool': name, 'input': inp})}\n\n"

        elif event.get("type") == "result":
            logger.info("chat: done cost=$%.4f", event.get("total_cost_usd", 0))
            yield "data: [DONE]\n\n"
            break

    await proc.wait()


@router.post("/stream")
async def chat_stream(req: ChatRequest):
    cwd = req.workspace_path or os.getcwd()
    prompt = _build_prompt(req.messages)
    logger.info("chat: messages=%d workspace=%s", len(req.messages), cwd)
    return StreamingResponse(
        _stream_claude(prompt, cwd),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
