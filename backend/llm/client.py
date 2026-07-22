from __future__ import annotations

import os
from typing import Optional, Protocol

from backend.llm.gemini_runtime import post_json_with_retry

DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_HOST = "https://generativelanguage.googleapis.com"


class LLMClient(Protocol):
    """Minimal chat-completion surface shared by every LLM call site in the app."""

    def complete(
        self,
        system: str,
        user: str,
        max_tokens: int = 2048,
        json_mode: bool = False,
        json_schema: Optional[dict] = None,
    ) -> str:
        ...


def _inline_refs(schema, defs: dict):
    """Resolve local $ref/$defs into a fully inlined schema.

    Gemini's `responseSchema` is an OpenAPI 3.0 subset with no notion of
    $ref/$defs, but Pydantic's `model_json_schema()` (what every call site here
    passes in) always emits nested models as $defs + $ref. This walks the tree
    and substitutes each $ref with its resolved definition so Gemini can
    actually grammar-constrain the output the way Ollama's raw-JSON-Schema
    `format` field used to.
    """

    if isinstance(schema, list):
        return [_inline_refs(item, defs) for item in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        return _inline_refs(defs[name], defs)
    return {
        key: _inline_refs(value, defs)
        for key, value in schema.items()
        if key not in ("title", "$defs")
    }


def _to_gemini_schema(schema: dict) -> dict:
    return _inline_refs(schema, schema.get("$defs", {}))


class GeminiLLM:
    """Chat completion via Google's Gemini API."""

    def __init__(self, model: str = DEFAULT_MODEL, api_key: str | None = None, host: str | None = None) -> None:
        self.model = model
        self.api_key = api_key or os.environ["GEMINI_API_KEY"]
        self.host = host or os.getenv("GEMINI_HOST", DEFAULT_HOST)
        self.last_degraded = False

    def complete(
        self,
        system: str,
        user: str,
        max_tokens: int = 2048,
        json_mode: bool = False,
        json_schema: Optional[dict] = None,
    ) -> str:
        generation_config: dict = {"maxOutputTokens": max_tokens}
        if json_schema is not None:
            # Grammar-constrained structured output: unlike plain JSON mode
            # (which only guarantees syntactically valid JSON), passing the
            # actual schema constrains enum/string fields too — e.g. an entity
            # `type` can only ever be one of the Literal values Pydantic
            # expects, instead of the model inventing its own labels
            # ("organization") that then fail validation and get silently
            # discarded by the caller.
            generation_config["responseMimeType"] = "application/json"
            generation_config["responseSchema"] = _to_gemini_schema(json_schema)
        elif json_mode:
            generation_config["responseMimeType"] = "application/json"

        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": generation_config,
        }
        result = post_json_with_retry(
            f"{self.host}/v1beta/models/{self.model}:generateContent",
            params={"key": self.api_key},
            json=payload,
            timeout=120.0,
        )
        self.last_degraded = result.degraded
        return result.response.json()["candidates"][0]["content"]["parts"][0]["text"]


def get_llm_client() -> Optional[LLMClient]:
    """Return the Gemini client, or None if disabled via DISABLE_LLM=1 or
    GEMINI_API_KEY isn't configured.

    Callers already handle a falsy/failing client by degrading to their
    rule-based or deterministic-template fallback path.
    """

    if os.getenv("DISABLE_LLM") == "1":
        return None
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    return GeminiLLM(model=os.getenv("GEMINI_MODEL", DEFAULT_MODEL), api_key=api_key)
