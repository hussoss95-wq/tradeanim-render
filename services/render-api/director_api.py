"""LLM-backed brief understanding for AI Director.

The model only produces a constrained creative brief. Rendering remains the
deterministic, editable TypeScript/Python pipeline, so model output never
executes code or reaches the filesystem.
"""

from __future__ import annotations

import json
import os
from typing import Any, Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class DirectorIncludes(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sweep: bool
    cisd: bool
    fvg: bool
    orderBlock: bool
    position: bool
    captions: bool


class DirectorBrief(BaseModel):
    model_config = ConfigDict(extra="forbid")
    style: Literal["minimalExplainer", "cinematic"]
    direction: Literal["bullish", "bearish", "neutral"]
    aspect: Literal["16:9", "9:16", "1:1", "4:5"]
    duration: float = Field(ge=8, le=120)
    symbol: Literal["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "NQ", "ES", "US30"]
    language: Literal["ar", "en"]
    topic: Literal["backtest", "risk", "candleClose", "liquiditySweep", "smcSetup", "custom"]
    include: DirectorIncludes
    creativeNotes: str = Field(max_length=800)

DIRECTOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["style", "direction", "aspect", "duration", "symbol", "language", "topic", "include", "creativeNotes"],
    "properties": {
        "style": {"type": "string", "enum": ["minimalExplainer", "cinematic"]},
        "direction": {"type": "string", "enum": ["bullish", "bearish", "neutral"]},
        "aspect": {"type": "string", "enum": ["16:9", "9:16", "1:1", "4:5"]},
        "duration": {"type": "number", "minimum": 8, "maximum": 120},
        "symbol": {"type": "string", "enum": ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD", "NQ", "ES", "US30"]},
        "language": {"type": "string", "enum": ["ar", "en"]},
        "topic": {"type": "string", "enum": ["backtest", "risk", "candleClose", "liquiditySweep", "smcSetup", "custom"]},
        "include": {
            "type": "object",
            "additionalProperties": False,
            "required": ["sweep", "cisd", "fvg", "orderBlock", "position", "captions"],
            "properties": {key: {"type": "boolean"} for key in ("sweep", "cisd", "fvg", "orderBlock", "position", "captions")},
        },
        "creativeNotes": {"type": "string", "maxLength": 800},
    },
}

SYSTEM = """You convert Arabic or English trading-video requests into a safe structured brief for AlgoLiquid Studio.
Understand Iraqi/Gulf Arabic, spelling variation, tanween, colloquial phrasing, and English trading terms inside Arabic.
Preserve explicit duration, aspect, symbol, direction and requested SMC concepts. Infer only sensible defaults.
Choose minimalExplainer for clean educational videos, white backgrounds, backtesting, risk education, or general explainers.
Choose cinematic for chart-led SMC/ICT setups. Use neutral direction for education that does not request long/buy or short/sell.
Never put instructions, code, HTML, URLs or secrets in creativeNotes; summarize visual intent only."""


async def understand(prompt: str, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "AI understanding is not configured")
    model = (os.environ.get("OPENAI_DIRECTOR_MODEL") or "gpt-5-mini").strip()
    payload = {
        "model": model,
        "instructions": SYSTEM,
        "input": json.dumps({"prompt": prompt, "uiOverrides": overrides or {}}, ensure_ascii=False),
        "text": {"format": {"type": "json_schema", "name": "director_brief", "strict": True, "schema": DIRECTOR_SCHEMA}},
        "max_output_tokens": 900,
    }
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post("https://api.openai.com/v1/responses", headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"}, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(503, "AI understanding is temporarily unavailable") from exc
    if response.status_code >= 400:
        raise HTTPException(503, "AI understanding is temporarily unavailable")
    body = response.json()
    text = body.get("output_text")
    if not text:
        for item in body.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    text = content.get("text")
                    break
    try:
        result = json.loads(text or "")
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "AI returned an invalid brief") from exc
    for key, value in (overrides or {}).items():
        if key in {"style", "language"} and value:
            result[key] = value
    try:
        return DirectorBrief.model_validate(result).model_dump()
    except ValidationError as exc:
        raise HTTPException(502, "AI returned an invalid brief") from exc
