"""AI coach chat: streams the model's answer as NDJSON events."""
from __future__ import annotations

import json
import os
from typing import List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_coach import agent, mistral

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=20_000)


class ChatIn(BaseModel):
    messages: List[ChatMessage] = Field(min_length=1, max_length=60)


@router.get("/status")
def status():
    return {"configured": bool(os.environ.get("MISTRAL_API_KEY", "").strip()), "model": mistral.chat_model()}


@router.post("")
def chat(body: ChatIn):
    """One NDJSON event per line: tool / text / error / done (see ai_coach.agent)."""
    history = [m.model_dump() for m in body.messages]

    def events():
        for event in agent.run(history):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
