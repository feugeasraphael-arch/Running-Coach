"""The coach conversation loop: system prompt + tool calling + streaming.

`run()` yields small JSON-able events that the /api/chat endpoint forwards
to the browser as NDJSON:
    {"type": "tool", "name", "label"}   a data lookup started
    {"type": "text", "delta"}           answer text
    {"type": "error", "message"}
    {"type": "done"}
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Iterator, Optional

from ai_coach import context, mistral, models
from ai_coach.tools import TOOL_SPECS, run_tool, tool_label

log = logging.getLogger("run_coach.ai")

MAX_TOOL_ROUNDS = 6
MAX_HISTORY_MESSAGES = 30

SYSTEM_PROMPT = """You are Run Coach, a personal running coach built into the athlete's own training dashboard.

{physiology}

---

# OPERATING CONTEXT

Today is {today}. The athlete trains with Strava + a Garmin watch and follows a training plan (a French 10K-oriented block: interval sessions like 5x1km and Norwegian 4x4, easy runs, long runs, benchmark tests).

## How you work
- The coaching doctrine and reference files above are binding. Every session you prescribe must carry its four obligations: physiological stimulus, target pace AND HR, justified recovery, and the Joyner & Coyle determinant it serves.
- Ground every statement about the athlete in data you fetched with your tools during this conversation. Never guess or invent numbers, dates, paces or sessions. If a tool returns no data, say so plainly.
- Call tools proactively: for "how am I doing / what should I do tomorrow", check recovery, training load and the plan before answering. Prefer a few targeted calls over dumping everything.
- Units in the data: distances in metres (distance_m) or km (…_km), durations in seconds, pace in seconds per km (convert to min:ss /km when you speak), HR in bpm.
- ACWR is a rough heuristic with real scientific criticism; use it as one signal among recovery, plan adherence and how recent sessions went, never as a hard rule.
- The dashboard's HR zones come from Strava's five-zone split, which is NOT the Z1-Z5 model in the reference above. When you quote a zone from a tool, name it as Strava's; when you prescribe, use the reference model and give the bpm range so there is no ambiguity.

## Coaching style
- Be concise and concrete: lead with the answer/recommendation, then the 2-4 data points that justify it. Use short Markdown (bold key numbers, bullet lists, small tables for comparisons).
- Say explicitly when you rely on general sports-science knowledge rather than on the athlete's own data.
- You cannot change the training plan yet: when an adjustment is warranted, describe it precisely (which day, what session, targets) so the athlete can apply it.
- Safety: for pain, injury, illness, chest symptoms or dizziness, advise stopping/reducing training and seeing a medical professional; don't diagnose.

## Language
Always reply in English, even if the athlete writes in another language. The athlete's activity names come from Strava in French: keep their session names exactly as they wrote them, and never translate them.

# LIVE STATE OF THE ATHLETE

This is rebuilt from the database at the start of every conversation. It is a photograph, not a subscription: the training plan is re-imported from the athlete's calendar on each sync and can change at any moment, including mid-conversation. Re-read it with `get_training_plan` whenever the answer depends on it, and never quote a planned session from memory of an earlier turn.

{live}
"""


def _clean_history(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages[-MAX_HISTORY_MESSAGES:]:
        role, content = m.get("role"), m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content})
    return out


def run(history: list[dict], model: Optional[str] = None) -> Iterator[dict]:
    """`model` is a Mistral model id from the picker (see ai_coach.models);
    None means the .env default."""
    messages: list[dict] = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT.format(
                physiology=context.block(),
                today=date.today().strftime("%A %d %B %Y"),
                live=context.live_block(),
            ),
        },
        *_clean_history(history),
    ]
    if len(messages) == 1 or messages[-1]["role"] != "user":
        yield {"type": "error", "message": "The conversation must end with a user message."}
        return

    try:
        for _round in range(MAX_TOOL_ROUNDS + 1):
            text_parts: list[str] = []
            calls: dict[int, dict] = {}
            # On the last round tools are withheld so the model must answer.
            tools = TOOL_SPECS if _round < MAX_TOOL_ROUNDS else None

            for delta in models.stream_chat(model, messages, tools=tools):
                content = delta.get("content")
                if isinstance(content, str) and content:
                    text_parts.append(content)
                    yield {"type": "text", "delta": content}
                for i, tc in enumerate(delta.get("tool_calls") or []):
                    idx = tc.get("index", i)
                    slot = calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                    slot["id"] = tc.get("id") or slot["id"]
                    fn = tc.get("function") or {}
                    slot["name"] = fn.get("name") or slot["name"]
                    args = fn.get("arguments")
                    if isinstance(args, dict):
                        slot["arguments"] = json.dumps(args)
                    elif isinstance(args, str):
                        slot["arguments"] += args

            if not calls:
                yield {"type": "done"}
                return

            ordered = [calls[k] for k in sorted(calls)]
            messages.append({
                "role": "assistant",
                "content": "".join(text_parts),
                "tool_calls": [
                    {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                    for c in ordered
                ],
            })
            for c in ordered:
                yield {"type": "tool", "name": c["name"], "label": tool_label(c["name"])}
                result = run_tool(c["name"], c["arguments"])
                messages.append({"role": "tool", "tool_call_id": c["id"], "name": c["name"], "content": result})

        yield {"type": "done"}
    except (mistral.MistralError, models.UnknownModel) as exc:
        yield {"type": "error", "message": str(exc)}
    except Exception as exc:  # noqa: BLE001
        log.exception("coach chat failed")
        yield {"type": "error", "message": f"Unexpected error: {exc}"}
