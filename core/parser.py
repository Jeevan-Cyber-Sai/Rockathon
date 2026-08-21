"""Turning a plain-English buying brief into structured, confidence-scored rules.

LLM first (Groq, retried once on bad JSON), regex fallback if the LLM is
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
import subprocess
import sys
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from typing import Literal

from .normalise import parse_delivery_days, parse_ram_gb, parse_storage

log = logging.getLogger("parser")

load_dotenv()

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
REQUEST_TIMEOUT = 8  # inner requests-level timeout, defense in depth only - see below

# The real bound. `requests.post(..., timeout=REQUEST_TIMEOUT)` alone was
# observed NOT to reliably bound a stalled connection - one call hung 18+
# minutes past its supposed 8s bound (a DNS-resolution-style stall happens
# before requests' own timeout can even apply). The call is run in a plain
# `python -c` child process (no shell, no bash dependency - `bash -c` broke
# outright on Windows when launched via plain uvicorn, FileNotFoundError) and
# hard-killed with Popen.kill() if it outlives this budget - TerminateProcess
# on Windows is unconditional and immediate regardless of what the child is
# blocked on, which is what actually enforces the LLM call's wall-clock budget.
HARD_TIMEOUT_SECONDS = 10

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
delivery_days.

ALWAYS also include product_type: a short, plain-English product category (e.g. "laptop", \
"water bottle", "office chair", "wireless keyboard") as a string value, op "==", elastic \
false, confidence reflecting how clearly the brief names the category (usually high - the \
product being bought is rarely ambiguous). This is used verbatim as an Amazon search term, \
so keep it a short, natural noun phrase - not a full restatement of the brief.

For any OTHER attribute the brief states that isn't one of the standard numeric fields \
above (material, capacity, connectivity, a feature, a certification, a size, a color, \
anything a listing's title would plausibly mention), invent a clear snake_case key. Two \
shapes for the value, depending on what kind of attribute it is:

- A MEASURED QUANTITY (capacity, wattage, screen size, battery, weight - anything with a \
number and a unit): write it as plain "NUMBER+UNIT" text - "400L", "20000mAh", "65 inch" \
- not just the bare number. The matching engine treats these as a MINIMUM by default: \
"400L capacity" accepts a 411L or 431L listing, the same convention already used for \
ram_gb/storage_gb ("at least 16GB" accepts 32GB). Use op ">=" unless the brief clearly \
wants a maximum ("no more than 400L" -> "<=") or a true exact value ("exactly 400L" -> \
"=="). This is measuring real-world quantities pulled from marketing text, so op "==" \
should be rare - only when the brief's own wording leaves no other reading.

- A TEXT PHRASE (material, connectivity, a named feature, a certification): a short \
phrase describing what a matching listing's title should contain, written the way a \
seller would actually write it - "stainless steel" not "steel material", "leak proof" not \
"leakproof=true", "bluetooth" not "wireless connectivity type". Use op "==".

Only include a key the brief actually states or clearly implies - never invent an unstated \
constraint.

Elasticity: quantity and price/budget caps are almost always rigid (elastic=false) unless \
the brief says otherwise ("budget flexible", "quantity approximate"). Delivery time and \
soft specs (including every attribute above, both shapes) are usually bendable \
(elastic=true) unless stated as a hard requirement.

For the attributes above specifically, elastic=false is a much stronger claim than "the \
brief mentions this" - it means a real listing gets REJECTED outright if its title doesn't \
confirm the value, and seller-written titles routinely omit true details (a fridge's own \
color is often just never mentioned). So elastic=false should be reserved for attributes a \
real title would almost always state if true (a brand name; a category-defining feature \
like "4K" or "wireless") or ones the brief insists on with exclusive language ("only in \
black", "must be exactly 400L", "no other colour"). A plainly-stated but easy-to-omit \
detail - color, an exact minor measurement, packaging - should default to elastic=true \
even when the brief states it as a plain fact, not a wish.

RIGID signals (elastic=false, higher confidence): "maximum", "must", "no more than", \
"exactly", "cap", "at most", "only", "no other".
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
Example output: {"product_type": {"value": "laptop", "op": "==", "elastic": false, \
"confidence": 0.95}, "quantity": {"value": 10, "op": ">=", "elastic": false, "confidence": \
0.95}, "ram_gb": {"value": 16, "op": ">=", "elastic": false, "confidence": 0.9}, \
"storage_gb": {"value": 512, "op": ">=", "elastic": false, "confidence": 0.9}, \
"price_per_unit": {"value": 45000, "op": "<=", "elastic": false, "confidence": 0.95}, \
"delivery_days": {"value": 7, "op": "<=", "elastic": true, "confidence": 0.8}}

Example brief: "20 stainless steel water bottles, 1 litre, leak proof, under 500"
Example output: {"product_type": {"value": "water bottle", "op": "==", "elastic": false, \
"confidence": 0.95}, "quantity": {"value": 20, "op": ">=", "elastic": false, "confidence": \
0.9}, "price_per_unit": {"value": 500, "op": "<=", "elastic": false, "confidence": 0.9}, \
"material": {"value": "stainless steel", "op": "==", "elastic": true, "confidence": 0.8}, \
"capacity": {"value": "1 litre", "op": "==", "elastic": true, "confidence": 0.75}, \
"leak_proof": {"value": "leak proof", "op": "==", "elastic": true, "confidence": 0.75}}"""

_STRICT_SUFFIX = ("\n\nYour previous reply was not valid JSON matching the schema above. "
                   "Reply with the JSON object ONLY - no markdown fences, no commentary. "
                   "If a rule has no explicit number stated in the brief, OMIT that key "
                   "entirely - never fill in a placeholder value like 0 just to satisfy "
                   "the schema.")


def _extract_json_object(content: str | None) -> dict:
    """Strip markdown fences / stray prose and parse the first {...} block."""
    if not content:
        # A reasoning model can burn its whole completion budget on hidden
        # reasoning and leave content empty/None - a malformed answer, not a
        # crash. Raising ValueError here is what makes that flow into the
        # same retry-then-regex-fallback path as any other bad response.
        raise ValueError("empty response content (model likely ran out of "
                         "completion tokens before writing an answer)")
    text = content.strip()
    # Some reasoning models (qwen's thinking mode, DeepSeek-R1 style, ...)
    # narrate their reasoning inline as visible <think>...</think>, often
    # previewing or drafting the answer JSON multiple times inside it. A
    # naive first-{-to-last-} span then swallows that prose along with the
    # real JSON. Cut the whole reasoning block out before extracting - the
    # real answer is what's left after it.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    if "<think>" in text:
        # An opening tag with no matching close means generation was cut off
        # mid-thought (out of completion tokens) - same failure as gpt-oss's
        # empty content, just visible instead of hidden. Nothing after this
        # point can be trusted as the real answer.
        raise ValueError("reasoning block never closed (model likely ran out "
                         "of completion tokens mid-thought)")
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"no JSON object found in: {content[:200]!r}")
    return json.loads(text[start:end + 1])


def _dated_system_prompt() -> str:
    now = datetime.now(timezone.utc)
    return SYSTEM_PROMPT + f"\n\nToday's date is {now:%Y-%m-%d} ({now:%A})."


# The subprocess's argv never carries the API key or the brief text (both go
# in via stdin/env) - only this fixed snippet appears in a process listing.
_WORKER_SNIPPET = (
    "import sys,json,os,requests\n"
    "p=json.loads(sys.stdin.read())\n"
    "try:\n"
    "    r=requests.post(p['url'],headers={'Authorization':'Bearer '+os.environ.get('GROQ_API_KEY',''),"
    "'Content-Type':'application/json'},json=p['body'],timeout=" + str(REQUEST_TIMEOUT) + ")\n"
    "    print(json.dumps({'status':r.status_code,'body':r.text}))\n"
    "except Exception as e:\n"
    "    print(json.dumps({'status':None,'error':str(e)}))\n"
)


def _post_with_hard_timeout(url: str, body: dict, timeout_s: float) -> tuple[int, str]:
    """Runs the actual HTTP call in a plain `python -c` child process - no
    shell, no bash dependency (an earlier bash-`timeout`-wrapped version broke
    outright on Windows under plain uvicorn: FileNotFoundError, bash not on
    PATH). Popen.kill() on timeout maps to TerminateProcess on Windows, which
    is unconditional and immediate no matter what the child is blocked on -
    that kill is what actually enforces the wall-clock budget, not the
    `timeout=` passed to communicate(), which only decides when to call it.
    Raises TimeoutError if it doesn't return in time, or RuntimeError on any
    other failure to reach Groq.
    """
    payload = json.dumps({"url": url, "body": body})
    budget = max(timeout_s, 0.5)

    proc = subprocess.Popen(
        [sys.executable, "-c", _WORKER_SNIPPET],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8",
    )
    try:
        stdout, stderr = proc.communicate(input=payload, timeout=budget)
    except subprocess.TimeoutExpired:
        proc.kill()   # TerminateProcess - immediate, regardless of what it's stuck on
        proc.wait()   # reap it so it doesn't linger as a zombie/handle leak
        raise TimeoutError(f"hard-killed: no response within {budget:.1f}s")

    if proc.returncode != 0 or not stdout.strip():
        raise RuntimeError(f"Groq subprocess failed (exit {proc.returncode}): "
                           f"{stderr[-300:] or '(no stderr)'}")

    outer = json.loads(stdout)
    if outer.get("status") is None:
        raise RuntimeError(f"request failed inside subprocess: {outer.get('error')}")
    return outer["status"], outer["body"]


def _call_openrouter(text: str, api_key: str, strict: bool, timeout_s: float) -> dict:
    """One request/response round trip. Raises on any failure - caller handles retry."""
    system = _dated_system_prompt() + (_STRICT_SUFFIX if strict else "")
    body = {
        "model": GROQ_MODEL,
        "temperature": 0,
        # Reasoning models (gpt-oss, etc.) spend most of their completion
        # budget on hidden reasoning before writing the actual JSON - at
        # 1000 this model was observed spending 609 tokens reasoning and
        # only ~100 left for output, one bad sample away from running out
        # before writing anything. Non-reasoning models just use less.
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ],
    }
    status, text_body = _post_with_hard_timeout(GROQ_URL, body, timeout_s)
    if status != 200:
        raise requests.HTTPError(f"{status} error from Groq: {text_body[:200]}")
    content = json.loads(text_body)["choices"][0]["message"]["content"]
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
    """Both attempts together share one HARD_TIMEOUT_SECONDS wall-clock budget.
    A stalled first attempt that eats the whole budget skips the retry rather
    than doubling the wait - the point is a bounded total, not two more chances.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        log.warning("GROQ_API_KEY not set - using regex fallback")
        return None

    deadline = time.monotonic() + HARD_TIMEOUT_SECONDS
    for attempt, strict in enumerate((False, True), start=1):
        remaining = deadline - time.monotonic()
        if remaining <= 0.5:
            log.warning("no time left in the %ss budget - skipping attempt %d",
                       HARD_TIMEOUT_SECONDS, attempt)
            break
        try:
            raw = _call_openrouter(text, api_key, strict=strict, timeout_s=remaining)
            known, other = _rules_from_raw_dict(raw)
        except (requests.RequestException, TimeoutError, RuntimeError, ValueError,
                KeyError, IndexError, json.JSONDecodeError, ValidationError) as exc:
            log.warning("LLM parse attempt %d failed: %s", attempt, exc)
            continue
        return ParsedBrief(raw_text=text, source="llm", other=other, **known)

    log.warning("LLM parse failed within the %ss hard budget - falling back to regex",
               HARD_TIMEOUT_SECONDS)
    return None


# --- regex fallback -------------------------------------------------------

_RIGID_WORDS = ("maximum", "must", "no more than", "exactly", "cap", "at most",
                 "not more than", "at least")
_BENDABLE_WORDS = ("within", "ideally", "around", "~", "roughly", "approximately",
                    "flexible", "preferably", "or so")

# Words that follow a number as a UNIT, never as the thing being bought -
# "16 GB", "7 days", "1.5 litre". Without excluding these, any number in the
# brief followed by a word would read as a quantity.
_QTY_UNIT_WORDS = (
    r"gb|tb|mb|kb|mah|mm|cm|ft|kg|kgs|ml|l|litre|litres|liter|liters|"
    r"w|watt|watts|v|volt|volts|hz|ghz|mhz|inch|inches|"
    r"day|days|hour|hours|min|mins|minute|minutes|week|weeks|month|months|"
    r"year|years|rs|rupees|percent|pm|am"
)

# Any noun, not a fixed list: the old list was laptop-era
# (laptops|chairs|desks|monitors|units|pieces|items), so "5 chargers" or
# "5 power banks" parsed no quantity at all and silently fell back to 1 -
# an order for one unit instead of five.
#
# The lookbehind stops a number that is part of a larger literal from being
# read as a count: the "000" in "Rs 45,000 per unit" and the "5" in "1.5
# litre" are both preceded by a comma/dot and are not quantities.
_QTY_WITH_NOUN = re.compile(
    r"(~|\bapprox(?:imately)?\s+|\baround\s+)?(?<![\d,.])\b(\d{1,4})\s*(?:x\s*)?"
    r"\b(?!(?:" + _QTY_UNIT_WORDS + r")\b)([a-z]{3,})\b", re.I)
_QTY_WITH_VERB = re.compile(r"\b(?:need|want|buy|get|order)\s+(~|about\s+)?(\d{1,4})\b", re.I)

_RUPEE = re.compile(r"[₹]|\brs\.?\b", re.I)
_MONEY_TOKEN = re.compile(
    r"(?:[₹]|\brs\.?\s*)\s*([\d,]+(?:\.\d+)?)\s*(k)?\b"          # ₹45,000 / Rs 45k
    r"|\b(\d{1,3}(?:,\d{3})*|\d+)\s*k\b(?!\s*(?:gb|tb|hz))", re.I)     # bare "45k"

# A bare number with no currency symbol and no "k" - "under 45000", "budget
# 45000", "cap at 45000" - is still unambiguously a price when a clear price
# word sits right before it. Excludes a trailing unit word so "under 7 days"
# or "at least 16 GB" can never be misread as a price.
_BARE_PRICE = re.compile(
    r"\b(?:under|below|up to|less than|max(?:imum)?|budget(?:\s+of)?|"
    r"cap(?:ped)?\s+at|no\s+more\s+than)\s+(?:rs\.?\s*|₹\s*)?"
    r"(\d{1,3}(?:,\d{3})*|\d{4,7})\b(?!\s*(?:gb|tb|days?|hours?|%|k\b))", re.I)


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
    if value < 1:
        return None  # "0 of something" is a misread, not an order

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
    if m:
        digits = m.group(1) or m.group(3)
        is_k = bool(m.group(2)) or (m.group(3) is not None and "k" in m.group(0).lower())
        value = int(float(digits.replace(",", "")) * (1000 if is_k else 1))
        elastic, confidence = _elasticity(text, m.start(), m.end(), default_elastic=False)
        return Rule(value=value, op="<=", elastic=elastic, confidence=confidence)

    # No currency symbol and no "k" suffix - only trust a bare number as a
    # price when a price-context word (under/budget/cap/...) sits right
    # before it. Lower confidence: this is inference, not a currency marker.
    m = _BARE_PRICE.search(text)
    if m:
        value = int(m.group(1).replace(",", ""))
        elastic, confidence = _elasticity(text, m.start(), m.end(), default_elastic=False)
        return Rule(value=value, op="<=", elastic=elastic, confidence=min(confidence, 0.65))
    return None


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


_DELIVERY_ANCHOR = re.compile(r"\d+\s*days?|\bdeliver\w*\b|\barriv\w*\b|\bship\w*\b|\bwithin\b", re.I)


def _regex_delivery(text: str) -> Rule | None:
    value = parse_delivery_days(text)
    if value is None:
        return None
    # A whole-text elasticity scan picks up rigid/bendable words from OTHER
    # clauses ("at least 16GB", "maximum Rs 45,000") and misattributes them to
    # delivery. Anchor near an actual delivery-shaped token when one exists;
    # only fall back to the whole brief when nothing local can be found (e.g.
    # a bare weekday name with no "days"/"deliver"/"within" nearby).
    m = _DELIVERY_ANCHOR.search(text)
    start, end = (m.start(), m.end()) if m else (0, len(text))
    elastic, confidence = _elasticity(text, start, end, default_elastic=True)
    return Rule(value=value, op="<=", elastic=elastic, confidence=confidence)


# --- product_type (regex fallback) ------------------------------------------

_LEADING_NUMBER = re.compile(r"\b(\d{1,4})\b")
# Words that can precede or interrupt the noun phrase without being part of
# it - once one of these is hit after the phrase has started, the phrase is
# over. "of"/"x" are allowed to precede without ending anything ("10 x
# chairs", "a lot of monitors" never comes up here, but harmless either way).
_PRODUCT_TYPE_STOPWORDS = {
    "needed", "required", "with", "under", "for", "within", "at", "by",
    "delivery", "budget", "cost", "price", "max", "maximum", "min",
    "minimum", "and", "or", "the", "a", "an", "to", "on", "up", "no",
    "more", "than", "each", "per", "unit", "units", "approx",
    "approximately", "around", "about", "least", "most", "of", "x",
    # Measurement units - a number+unit right after the product noun
    # ("1.5 litre", "20000mAh") loses its digits when only letters are
    # extracted, so without this the unit word gets mistaken for part of
    # the noun phrase ("electric kettles litre" instead of "electric
    # kettle").
    "litre", "litres", "liter", "liters", "ml", "kg", "kgs", "gram",
    "grams", "cm", "mm", "inch", "inches", "ft", "hour", "hours", "min",
    "mins", "minutes", "watt", "watts", "mah", "gb", "tb",
}


def _singularize(word: str) -> str:
    """Best-effort, not a lemmatizer: 'mats' -> 'mat', 'chairs' -> 'chair',
    'leashes' -> 'leash' (the common -shes/-ches/-xes "-es" plural, not just
    "-s"). Leaves short words and words already ending 'ss' alone rather
    than risk a wrong strip ('glasses' -> 'glasse')."""
    if len(word) > 4 and word.endswith(("shes", "ches", "xes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _regex_product_type(text: str) -> Rule | None:
    """Best-effort product-name guess for when the LLM path is unavailable:
    the first noun phrase right after the quantity number - "10 yoga mats
    needed..." -> "yoga mat". Not meant to match the LLM's judgment (no
    quantity anchor as sophisticated as _regex_quantity's noun list, since
    the whole point here is a noun the fallback doesn't already know) - just
    enough that _build_query() searches for something plausible instead of
    silently defaulting to "laptop" whenever a brief isn't laptop-shaped."""
    m = _LEADING_NUMBER.search(text)
    if not m:
        return None
    words = re.findall(r"[a-zA-Z]+", text[m.end():])
    phrase: list[str] = []
    for w in words:
        lw = w.lower()
        if lw in _PRODUCT_TYPE_STOPWORDS:
            if phrase:
                break        # phrase already started - a stopword ends it
            continue         # phrase hasn't started yet - skip filler and keep looking
        phrase.append(lw)
        if len(phrase) >= 3:
            break
    if not phrase:
        return None
    phrase[-1] = _singularize(phrase[-1])
    return Rule(value=" ".join(phrase), op="==", elastic=False, confidence=0.5)


def _parse_via_regex(text: str) -> ParsedBrief:
    fields = {
        "quantity": _regex_quantity(text),
        "ram_gb": _regex_ram(text),
        "storage_gb": _regex_storage(text),
        "price_per_unit": _regex_price(text),
        "delivery_days": _regex_delivery(text),
    }
    known = {k: v for k, v in fields.items() if v is not None}
    product_type = _regex_product_type(text)
    other = {"product_type": product_type} if product_type is not None else {}
    return ParsedBrief(raw_text=text, source="regex", other=other, **known)


# --- public entry point ----------------------------------------------------


def parse_brief(text: str) -> ParsedBrief:
    """Plain-English buying brief -> structured, confidence-scored rules.

    Tries the LLM (with one retry on invalid JSON), falls back to a regex
    parser if GROQ_API_KEY is missing or the LLM keeps failing.
    """
    brief = _parse_via_llm(text) or _parse_via_regex(text)
    brief.needs_confirmation = sorted(
        name for name, rule in brief.all_rules().items() if rule.confidence < CONFIDENCE_THRESHOLD
    )
    return brief
