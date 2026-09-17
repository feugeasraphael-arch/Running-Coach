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
from typing import Iterator

import coach
from ai_coach import mistral
from ai_coach.tools import TOOL_SPECS, run_tool, tool_label
from api.deps import db

log = logging.getLogger("run_coach.ai")

MAX_TOOL_ROUNDS = 6
MAX_HISTORY_MESSAGES = 30

SYSTEM_PROMPT = """You are Run Coach, a personal running coach built into the athlete's own training dashboard.

Today is {today}. The athlete trains with Strava + a Garmin watch and follows a training plan (a French 10K-oriented block: interval sessions like 5x1km and Norwegian 4x4, easy runs, long runs, benchmark tests).

## How you work
- Ground every statement about the athlete in data you fetched with your tools during this conversation. Never guess or invent numbers, dates, paces or sessions. If a tool returns no data, say so plainly.
- Call tools proactively: for "how am I doing / what should I do tomorrow", check recovery, training load and the plan before answering. Prefer a few targeted calls over dumping everything.
- Units in the data: distances in metres (distance_m) or km (…_km), durations in seconds, pace in seconds per km (convert to min:ss /km when you speak), HR in bpm.
- ACWR is a rough heuristic with real scientific criticism; use it as one signal among recovery, plan adherence and how recent sessions went, never as a hard rule.

## Coaching style
- Be concise and concrete: lead with the answer/recommendation, then the 2-4 data points that justify it. Use short Markdown (bold key numbers, bullet lists, small tables for comparisons).
- Base training advice on established endurance-training principles (progressive overload, most volume easy, hard/easy alternation, recovery before intensity, tapering before races). When you rely on general sports-science knowledge rather than the athlete's data, say so.
- You cannot change the training plan yet: when an adjustment is warranted, describe it precisely (which day, what session, targets) so the athlete can apply it.
- Safety: for pain, injury, illness, chest symptoms or dizziness, advise stopping/reducing training and seeing a medical professional; don't diagnose.

## Language
Reply in the language the athlete writes in (usually French). Keep the athlete's own session names as-is.

## Snapshot at the start of this conversation
{snapshot}
"""


def _snapshot() -> str:
    """A small always-on context block so simple questions need no tool call."""
    try:
        with db() as conn:
            acwr = coach.compute_acwr(conn)
            rec = coach.get_recovery_status(conn)
            plan = coach.get_plan_status(conn, 0, 1)
    except Exception as exc:  # noqa: BLE001
        return f"(snapshot unavailable: {exc})"
    lines = []
    if acwr.get("flag") and acwr["flag"] != "no_data":
        lines.append(f"- ACWR {acwr['ratio']} ({acwr['flag']}): last 7d {acwr['acute_km']} km, 28d weekly avg {acwr['chronic_km']} km")
    if rec.get("status") and rec["status"] != "no_data":
        lines.append(
            f"- Recovery {rec['status']} on {rec['date']}: body battery high {rec.get('body_battery_high')}, "
            f"HRV {rec.get('hrv_ms')}, readiness {rec.get('training_readiness')}"
        )
    nxt = plan.get("next_workout") if isinstance(plan, dict) else None
    if nxt:
        lines.append(f"- Next planned: {nxt['date']} {nxt['title']} ({nxt.get('workout_type')}; pace {nxt.get('pace_target')}; HR {nxt.get('hr_target')})")
    return "\n".join(lines) or "(no data synced yet)"


def _clean_history(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages[-MAX_HISTORY_MESSAGES:]:
        role, content = m.get("role"), m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content})
    return out


def run(history: list[dict]) -> Iterator[dict]:
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(today=date.today().strftime("%A %d %B %Y"), snapshot=_snapshot())},
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

            for delta in mistral.stream_chat(messages, tools=tools):
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
    except mistral.MistralError as exc:
        yield {"type": "error", "message": str(exc)}
    except Exception as exc:  # noqa: BLE001
        log.exception("coach chat failed")
        yield {"type": "error", "message": f"Unexpected error: {exc}"}
