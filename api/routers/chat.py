"""AI coach chat: streams the model's answer as NDJSON events."""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_coach import agent, models

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=20_000)


class ChatIn(BaseModel):
    messages: List[ChatMessage] = Field(min_length=1, max_length=60)
    model: Optional[str] = None  # a model id from /api/chat/status; None = .env default


@router.get("/status")
def status():
    """Whether the coach can answer, the default model and the models the
    picker offers (see ai_coach.models)."""
    return {
        "configured": models.configured(),
        "default_model": models.default_model(),
        "models": models.available(),
    }


@router.post("")
def chat(body: ChatIn):
    """One NDJSON event per line: tool / text / error / done (see ai_coach.agent)."""
    history = [m.model_dump() for m in body.messages]
    try:
        models.resolve(body.model)
    except models.UnknownModel as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def events():
        for event in agent.run(history, body.model):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
