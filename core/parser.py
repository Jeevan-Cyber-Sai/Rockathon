"""Turning a plain-English buying brief into structured, confidence-scored rules.

LLM first (OpenRouter, retried once on bad JSON), regex fallback if the LLM is
unavailable or keeps failing. The fallback is deliberately dumb: it reuses the
same spec/delivery parsers the retailer adapters already use, plus a small
keyword heuristic for rigid vs. bendable. It exists so a demo never dies on a
flaky API key, not to match the LLM's judgment.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from typing import Literal

from .normalise import parse_delivery_days, parse_ram_gb, parse_storage

log = logging.getLogger("parser")

load_dotenv()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "anthropic/claude-sonnet-5")
REQUEST_TIMEOUT = 8

CONFIDENCE_THRESHOLD = 0.7  # below this, a rule goes into needs_confirmation
KNOWN_FIELDS = ("quantity", "ram_gb", "storage_gb", "price_per_unit", "delivery_days")

Op = Literal[">=", "<=", "==", ">", "<", "~"]


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: float | int | str
    op: Op
    elastic: bool
    confidence: float = Field(ge=0.0, le=1.0)


class ParsedBrief(BaseModel):
    """The flat schema from the spec, plus provenance and a confirmation list.

    quantity/ram_gb/storage_gb/price_per_unit/delivery_days are the named
    fields from the spec's example. `other` holds anything else the brief
    stated (a product category, colour, material, ...) so a non-laptop brief
    like "5 chairs" is not forced to drop information into nowhere.
    """

    model_config = ConfigDict(extra="forbid")

    raw_text: str
    source: Literal["llm", "regex"]
    quantity: Rule | None = None
    ram_gb: Rule | None = None
    storage_gb: Rule | None = None
    price_per_unit: Rule | None = None
    delivery_days: Rule | None = None
    other: dict[str, Rule] = Field(default_factory=dict)
    needs_confirmation: list[str] = Field(default_factory=list)

    def all_rules(self) -> dict[str, Rule]:
        rules = {f: getattr(self, f) for f in KNOWN_FIELDS if getattr(self, f) is not None}
        rules.update(self.other)
        return rules


# --- LLM path -----------------------------------------------------------

SYSTEM_PROMPT = """You extract structured purchasing rules from a plain-English buying brief \
for a procurement agent.

Return ONLY a single JSON object. No prose, no markdown code fences, no explanation.
Each key is a snake_case rule name. Each value is an object of this exact shape:
  {"value": <number or string>, "op": one of ">=" "<=" "==" ">" "<" "~", \
"elastic": true or false, "confidence": a number from 0.0 to 1.0}

Use these standard names when they apply: quantity, ram_gb, storage_gb, price_per_unit, \
delivery_days. If the brief is not about laptops (chairs, monitors, anything else), still \
use quantity/price_per_unit/delivery_days where relevant, and invent a clear snake_case \
name for any other attribute actually stated (e.g. product_type, color, material). Only \
include a key the brief actually states or clearly implies - never invent an unstated \
constraint.

Elasticity: quantity and price/budget caps are almost always rigid (elastic=false) unless \
the brief says otherwise ("budget flexible", "quantity approximate"). Delivery time and \
soft specs are usually bendable (elastic=true) unless stated as a hard requirement.
RIGID signals (elastic=false, higher confidence): "maximum", "must", "no more than", \
"exactly", "cap", "at most".
BENDABLE signals (elastic=true): "within", "ideally", "around", "~", "roughly", \
"approximately", "flexible", "asap".
When the phrasing gives no clear signal either way, set elastic=true and confidence \
below 0.7.

delivery_days must always be a plain integer number of days from today - never a day \
name or date string. Convert weekday names, "tomorrow", relative phrases ("next month" \
= 30, "next week" = 7) and explicit dates into a day count yourself using the current \
date given below. Storage must be reported in GB using 1 TB = 1024 GB, matching how \
listings elsewhere in this system are parsed - "1TB SSD" means storage_gb=1024, not 1000.

Example brief: "10 laptops with at least 16GB RAM and 512GB SSD, maximum ₹45,000 per \
unit, delivery within 7 days"
Example output: {"quantity": {"value": 10, "op": ">=", "elastic": false, "confidence": \
0.95}, "ram_gb": {"value": 16, "op": ">=", "elastic": false, "confidence": 0.9}, \
"storage_gb": {"value": 512, "op": ">=", "elastic": false, "confidence": 0.9}, \
"price_per_unit": {"value": 45000, "op": "<=", "elastic": false, "confidence": 0.95}, \
"delivery_days": {"value": 7, "op": "<=", "elastic": true, "confidence": 0.8}}"""

_STRICT_SUFFIX = ("\n\nYour previous reply was not valid JSON matching the schema above. "
                   "Reply with the JSON object ONLY - no markdown fences, no commentary. "
                   "If a rule has no explicit number stated in the brief, OMIT that key "
                   "entirely - never fill in a placeholder value like 0 just to satisfy "
                   "the schema.")


def _extract_json_object(content: str) -> dict:
    """Strip markdown fences / stray prose and parse the first {...} block."""
    text = content.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"no JSON object found in: {content[:200]!r}")
    return json.loads(text[start:end + 1])


def _dated_system_prompt() -> str:
    now = datetime.now(timezone.utc)
    return SYSTEM_PROMPT + f"\n\nToday's date is {now:%Y-%m-%d} ({now:%A})."


def _call_openrouter(text: str, api_key: str, strict: bool = False) -> dict:
    """One request/response round trip. Raises on any failure - caller handles retry."""
    system = _dated_system_prompt() + (_STRICT_SUFFIX if strict else "")
    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": OPENROUTER_MODEL,
            "temperature": 0,
            "max_tokens": 1000,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    body = resp.json()
    content = body["choices"][0]["message"]["content"]
    return _extract_json_object(content)


def _rules_from_raw_dict(raw: dict) -> tuple[dict, dict]:
    """Split a validated {name: Rule} mapping into (known_fields, other).

    All five KNOWN_FIELDS are numeric by definition (a count, a size, a price,
    a day count) - "other" is the only place a string value belongs. A model
    that answers delivery_days with "friday" instead of computing the day
    count gets rejected here so the caller retries rather than silently
    handing the decision engine a string it cannot compare.
    """
    known, other = {}, {}
    for name, value in raw.items():
        rule = Rule(**value)  # raises ValidationError on a malformed rule -> triggers retry
        if name in KNOWN_FIELDS:
            if not isinstance(rule.value, (int, float)):
                raise ValueError(f"{name} must be numeric, got {rule.value!r}")
            if rule.value <= 0:
                # A price/quantity/size/day-count of 0 is not a real constraint -
                # it is a placeholder the model filled in rather than omitting
                # a key the brief never actually gave a number for.
                raise ValueError(f"{name} must be positive, got {rule.value!r}")
            known[name] = rule
        else:
            other[name] = rule
    return known, other


def _parse_via_llm(text: str) -> ParsedBrief | None:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        log.warning("OPENROUTER_API_KEY not set - using regex fallback")
        return None

    for attempt, strict in enumerate((False, True), start=1):
        try:
            raw = _call_openrouter(text, api_key, strict=strict)
            known, other = _rules_from_raw_dict(raw)
        except (requests.RequestException, ValueError, KeyError, IndexError,
                json.JSONDecodeError, ValidationError) as exc:
            log.warning("LLM parse attempt %d failed: %s", attempt, exc)
            continue
        return ParsedBrief(raw_text=text, source="llm", other=other, **known)

    log.warning("LLM parse failed twice - falling back to regex")
    return None


# --- regex fallback -------------------------------------------------------

_RIGID_WORDS = ("maximum", "must", "no more than", "exactly", "cap", "at most",
                 "not more than", "at least")
_BENDABLE_WORDS = ("within", "ideally", "around", "~", "roughly", "approximately",
                    "flexible", "preferably", "or so")

_QTY_WITH_NOUN = re.compile(
    r"(~|\bapprox(?:imately)?\s+|\baround\s+)?\b(\d{1,4})\s*(?:x\s*)?"
    r"(laptops?|chairs?|desks?|monitors?|units?|pieces?|items?)\b", re.I)
_QTY_WITH_VERB = re.compile(r"\b(?:need|want|buy|get|order)\s+(~|about\s+)?(\d{1,4})\b", re.I)

_RUPEE = re.compile(r"[₹]|\brs\.?\b", re.I)
_MONEY_TOKEN = re.compile(
    r"(?:[₹]|\brs\.?\s*)\s*([\d,]+(?:\.\d+)?)\s*(k)?\b"          # ₹45,000 / Rs 45k
    r"|\b(\d{1,3}(?:,\d{3})*|\d+)\s*k\b(?!\s*(?:gb|tb|hz))", re.I)     # bare "45k"


def _nearby(text: str, start: int, end: int, words: tuple[str, ...], window: int = 25) -> bool:
    ctx = text[max(0, start - window):end + window].lower()
    return any(w in ctx for w in words)


def _elasticity(text: str, start: int, end: int, default_elastic: bool) -> tuple[bool, float]:
    """(elastic, confidence) from keyword proximity, else the field's stated default."""
    if _nearby(text, start, end, _RIGID_WORDS):
        return False, 0.75
    if _nearby(text, start, end, _BENDABLE_WORDS):
        return True, 0.75
    return default_elastic, 0.55  # no signal - spec says elastic=true, confidence<0.7...
    # ...but a *rigid* field (quantity/price) with no signal stays rigid by the spec's
    # own rule ("budget caps and quantity are almost always rigid"); only its
    # confidence drops, via default_elastic passed in by the caller.


_QTY_EXACTLY = re.compile(r"\bexactly\b", re.I)
_QTY_CAP = re.compile(r"\b(no more than|at most|maximum|not more than)\b", re.I)


def _regex_quantity(text: str) -> Rule | None:
    """Default op is ">=" - a plain "10 laptops" means "at least 10 is fine",
    matching the spec's own worked example. "Exactly" tightens it to "==";
    an explicit cap phrase ("no more than") loosens it to "<=" instead.
    """
    m = _QTY_WITH_NOUN.search(text) or _QTY_WITH_VERB.search(text)
    if not m:
        return None
    groups = m.groups()
    approx_marker = groups[0]
    value = int(next(g for g in groups[1:] if g and g.isdigit()))

    if approx_marker:
        return Rule(value=value, op="~", elastic=True, confidence=0.7)

    ctx = text[max(0, m.start() - 25):m.end() + 25]
    if _QTY_EXACTLY.search(ctx):
        return Rule(value=value, op="==", elastic=False, confidence=0.85)
    if _QTY_CAP.search(ctx):
        return Rule(value=value, op="<=", elastic=False, confidence=0.8)

    elastic, confidence = _elasticity(text, m.start(), m.end(), default_elastic=False)
    return Rule(value=value, op=">=", elastic=elastic, confidence=confidence)


def _regex_price(text: str) -> Rule | None:
    m = _MONEY_TOKEN.search(text)
    if not m:
        return None
    digits = m.group(1) or m.group(3)
    is_k = bool(m.group(2)) or (m.group(3) is not None and "k" in m.group(0).lower())
    value = int(float(digits.replace(",", "")) * (1000 if is_k else 1))
    elastic, confidence = _elasticity(text, m.start(), m.end(), default_elastic=False)
    return Rule(value=value, op="<=", elastic=elastic, confidence=confidence)


def _regex_ram(text: str) -> Rule | None:
    value = parse_ram_gb(text)
    if value is None:
        return None
    m = re.search(re.escape(str(value)), text)
    elastic, confidence = _elasticity(text, m.start() if m else 0, m.end() if m else 0,
                                       default_elastic=False)
    return Rule(value=value, op=">=", elastic=elastic, confidence=confidence)


def _regex_storage(text: str) -> Rule | None:
    value, _ = parse_storage(text)
    if value is None:
        return None
    m = re.search(re.escape(str(value)), text)
    elastic, confidence = _elasticity(text, m.start() if m else 0, m.end() if m else 0,
                                       default_elastic=False)
    return Rule(value=value, op=">=", elastic=elastic, confidence=confidence)


def _regex_delivery(text: str) -> Rule | None:
    value = parse_delivery_days(text)
    if value is None:
        return None
    # Delivery has no single anchor token to search back from (it may have come
    # from a weekday name or a date); judge elasticity from the whole brief.
    elastic, confidence = _elasticity(text, 0, len(text), default_elastic=True)
    return Rule(value=value, op="<=", elastic=elastic, confidence=confidence)


def _parse_via_regex(text: str) -> ParsedBrief:
    fields = {
        "quantity": _regex_quantity(text),
        "ram_gb": _regex_ram(text),
        "storage_gb": _regex_storage(text),
        "price_per_unit": _regex_price(text),
        "delivery_days": _regex_delivery(text),
    }
    known = {k: v for k, v in fields.items() if v is not None}
    return ParsedBrief(raw_text=text, source="regex", **known)


# --- public entry point ----------------------------------------------------


def parse_brief(text: str) -> ParsedBrief:
    """Plain-English buying brief -> structured, confidence-scored rules.

    Tries the LLM (with one retry on invalid JSON), falls back to a regex
    parser if OPENROUTER_API_KEY is missing or the LLM keeps failing.
    """
    brief = _parse_via_llm(text) or _parse_via_regex(text)
    brief.needs_confirmation = sorted(
        name for name, rule in brief.all_rules().items() if rule.confidence < CONFIDENCE_THRESHOLD
    )
    return brief
