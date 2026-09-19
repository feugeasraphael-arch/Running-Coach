"""Minimal Mistral client (streaming + tool calls).

Uses `requests` directly rather than the `mistralai` SDK: the SDK's current
releases need Python >= 3.10 and this project runs on 3.9.

Two transports, picked with MISTRAL_API_MODE:
- "conversations" (default): POST /v1/conversations. On this account the
  frontier models (mistral-medium-2604) are only enabled through this API --
  /chat/completions returns a 0 requests/minute quota for them.
- "chat": the classic POST /v1/chat/completions.
Both are normalised to the same chat-completions-style deltas, so agent.py
doesn't care which one is in use.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Iterator, Optional

import requests

API_URL = os.environ.get("MISTRAL_BASE_URL", "https://api.mistral.ai/v1").rstrip("/")


class MistralError(Exception):
    """An API failure with a message that's safe to show the user."""


def _api_key() -> str:
    key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not key:
        raise MistralError("MISTRAL_API_KEY is not set in .env.")
    return key


def chat_model() -> str:
    return os.environ.get("MISTRAL_CHAT_MODEL", "mistral-medium-2604")


def api_mode() -> str:
    return os.environ.get("MISTRAL_API_MODE", "conversations").strip().lower()


def _explain(resp: requests.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    message = body.get("message") or resp.text[:200] or resp.reason
    if resp.status_code == 401:
        return "Mistral rejected the API key (401). Check MISTRAL_API_KEY in .env."
    if resp.status_code == 403 and body.get("type") == "tier_not_allowed":
        return f"The {chat_model()} model is not available on your Mistral plan."
    if resp.status_code == 429 and resp.headers.get("x-ratelimit-limit-req-minute") == "0":
        return (
            "Your Mistral workspace has no chat quota (0 requests/minute). Enable an API plan "
            "(the free Experiment tier or billing) at console.mistral.ai → Billing."
        )
    if resp.status_code == 429:
        return "Mistral rate limit reached — try again in a few seconds."
    return f"Mistral API error {resp.status_code}: {message}"


def _stream_chat_completions(
    messages: list[dict],
    tools: Optional[list[dict]] = None,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
) -> Iterator[dict]:
    """Yields the `choices[0].delta` dict of every streamed chunk.

    Retries a transient 429 (a real per-minute limit, not a zero quota) with
    short backoff before the stream starts; never retries mid-stream.
    """
    payload: dict[str, Any] = {
        "model": model or chat_model(),
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {"Authorization": f"Bearer {_api_key()}", "Accept": "text/event-stream"}
    for attempt in range(_ATTEMPTS):
        try:
            resp = requests.post(f"{API_URL}/chat/completions", headers=headers, json=payload, stream=True, timeout=(10, 120))
        except requests.RequestException as exc:
            raise MistralError(f"Could not reach Mistral: {exc}") from exc
        if _should_retry(resp, attempt):
            continue
        break
    _raise_for_status(resp)

    with resp:
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            data = raw[len("data:"):].strip()
            if data == "[DONE]":
                return
            try:
                chunk = json.loads(data)
            except ValueError:
                continue
            choices = chunk.get("choices") or []
            if choices:
                delta = dict(choices[0].get("delta") or {})
                delta["_finish_reason"] = choices[0].get("finish_reason")
                yield delta


_ATTEMPTS = 4


def _should_retry(resp: requests.Response, attempt: int) -> bool:
    """Back off on a transient 429 (per-minute request/token limit). A zero
    quota (limit header "0") is permanent, so it isn't retried."""
    zero_quota = resp.headers.get("x-ratelimit-limit-req-minute") == "0"
    if resp.status_code != 429 or zero_quota or attempt >= _ATTEMPTS - 1:
        return False
    resp.close()
    # Token-per-minute windows need a longer wait than request bursts.
    time.sleep(min(5 * (attempt + 1), 20))
    return True


def _raise_for_status(resp: requests.Response) -> None:
    if not resp.ok:
        msg = _explain(resp)
        resp.close()
        raise MistralError(msg)


def _to_conversation_inputs(messages: list[dict]) -> tuple[str, list[dict]]:
    """chat-completions messages -> (instructions, conversation entries)."""
    instructions: list[str] = []
    entries: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            instructions.append(m.get("content") or "")
        elif role == "user":
            entries.append({"type": "message.input", "role": "user", "content": m.get("content") or ""})
        elif role == "assistant":
            if m.get("content"):
                entries.append({"type": "message.output", "role": "assistant", "content": m["content"]})
            for tc in m.get("tool_calls") or []:
                fn = tc.get("function") or {}
                entries.append({
                    "type": "function.call",
                    "tool_call_id": tc.get("id"),
                    "name": fn.get("name"),
                    "arguments": fn.get("arguments") or "{}",
                })
        elif role == "tool":
            entries.append({"type": "function.result", "tool_call_id": m.get("tool_call_id"), "result": m.get("content") or ""})
    return "\n\n".join(instructions), entries


def _stream_conversations(
    messages: list[dict],
    tools: Optional[list[dict]],
    model: Optional[str],
    temperature: float,
    max_tokens: int,
) -> Iterator[dict]:
    instructions, inputs = _to_conversation_inputs(messages)
    payload: dict[str, Any] = {
        "model": model or chat_model(),
        "inputs": inputs,
        "stream": True,
        "store": False,  # stateless: the full history is replayed on every call
        "completion_args": {"temperature": temperature, "max_tokens": max_tokens},
    }
    if instructions:
        payload["instructions"] = instructions
    if tools:
        payload["tools"] = tools

    headers = {"Authorization": f"Bearer {_api_key()}", "Accept": "text/event-stream"}
    for attempt in range(_ATTEMPTS):
        try:
            resp = requests.post(f"{API_URL}/conversations", headers=headers, json=payload, stream=True, timeout=(10, 120))
        except requests.RequestException as exc:
            raise MistralError(f"Could not reach Mistral: {exc}") from exc
        if _should_retry(resp, attempt):
            continue
        break
    _raise_for_status(resp)

    with resp:
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            try:
                event = json.loads(raw[len("data:"):].strip())
            except ValueError:
                continue
            kind = event.get("type")
            if kind == "message.output.delta":
                content = event.get("content")
                if isinstance(content, str) and content:
                    yield {"content": content}
            elif kind == "function.call.delta":
                yield {
                    "tool_calls": [{
                        "index": event.get("output_index", 0),
                        "id": event.get("tool_call_id"),
                        "function": {"name": event.get("name"), "arguments": event.get("arguments") or ""},
                    }]
                }
            elif kind == "conversation.response.error":
                raise MistralError(f"Mistral error: {event.get('message') or event}")
            elif kind == "conversation.response.done":
                return


def stream_chat(
    messages: list[dict],
    tools: Optional[list[dict]] = None,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
) -> Iterator[dict]:
    """Yields chat-completions-style deltas: {"content": str} and/or
    {"tool_calls": [{index, id, function: {name, arguments}}]} where
    `arguments` arrives in fragments to concatenate."""
    if api_mode() == "chat":
        return _stream_chat_completions(messages, tools, model, temperature, max_tokens)
    return _stream_conversations(messages, tools, model, temperature, max_tokens)
