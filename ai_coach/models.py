"""The coach's model picker: which Mistral models can answer.

The catalog is curated (Mistral's commercial chat models, with tool calling --
the coach can't work without it) and then filtered against the live
/v1/models list, so the picker only offers what the configured key can
actually call.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Iterator, Optional

import requests

from ai_coach import mistral

log = logging.getLogger("run_coach.ai")

# (model id, label, one-line description), best first.
CATALOG: list[tuple[str, str, str]] = [
    ("mistral-large-latest", "Mistral Large 3", "The most capable"),
    ("mistral-medium-2604", "Mistral Medium 3.5", "Best balance for coaching"),
    ("mistral-small-2603", "Mistral Small 4", "Fast and cheap"),
    ("ministral-14b-2512", "Ministral 14B", "Compact, quick answers"),
    ("ministral-8b-2512", "Ministral 8B", "Very light"),
    ("ministral-3b-2512", "Ministral 3B", "Minimal — unreliable at tool use"),
]

_AVAILABILITY_TTL = 3600
_availability: Optional[tuple[float, Optional[set[str]]]] = None


class UnknownModel(ValueError):
    pass


def configured() -> bool:
    return bool(os.environ.get("MISTRAL_API_KEY", "").strip())


def _live_ids() -> Optional[set[str]]:
    """Model ids Mistral serves to this key, cached for an hour. None if the
    lookup failed -- the picker then shows the whole catalog rather than
    nothing."""
    global _availability
    if _availability and time.time() - _availability[0] < _AVAILABILITY_TTL:
        return _availability[1]
    try:
        resp = requests.get(
            f"{mistral.API_URL}/models",
            headers={"Authorization": f"Bearer {os.environ['MISTRAL_API_KEY'].strip()}"},
            timeout=5,
        )
        resp.raise_for_status()
        ids: Optional[set[str]] = {m["id"] for m in resp.json().get("data", [])}
    except Exception as exc:  # noqa: BLE001
        log.warning("could not list Mistral models: %s", exc)
        ids = None
    _availability = (time.time(), ids)
    return ids


def default_model() -> str:
    return mistral.chat_model()


def available() -> list[dict]:
    if not configured():
        return []
    live = _live_ids()
    return [
        {"id": model, "label": label, "description": description}
        for model, label, description in CATALOG
        if live is None or model in live
    ]


def resolve(model: Optional[str]) -> str:
    """Only catalog models (and the .env default) are accepted, so the browser
    can't point the coach at an arbitrary model."""
    model = model or default_model()
    if model == default_model() or any(m == model for m, _, _ in CATALOG):
        return model
    raise UnknownModel(f"Modèle inconnu : {model}")


def stream_chat(model: Optional[str], messages: list[dict], tools: Optional[list[dict]] = None) -> Iterator[dict]:
    return mistral.stream_chat(messages, tools=tools, model=resolve(model))
