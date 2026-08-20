"""Raw response cache. Checked before every API call, written after every one.

Development runs the same handful of queries hundreds of times; paid quota is
not the place to find that out. Cache files keep their timestamp in the name so
you can see at a glance what was fetched when.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

log = logging.getLogger("cache")

CACHE_DIR = Path(os.getenv("CACHE_DIR", Path(__file__).resolve().parent.parent / "data" / "raw"))
DEFAULT_TIMEOUT = 20

# Counters for the fetch.py summary line.
HITS = 0
MISSES = 0


def reset_stats() -> None:
    global HITS, MISSES
    HITS = MISSES = 0


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:48] or "query")


def _key(source: str, query: str) -> str:
    """Retailer + query. The hash keeps long/odd queries filesystem-safe."""
    digest = hashlib.sha1(f"{source}|{query}".encode()).hexdigest()[:8]
    return f"{_slug(source)}__{_slug(query)}__{digest}"


def newest(source: str, query: str, max_age_hours: float | None = None) -> Path | None:
    if not CACHE_DIR.exists():
        return None
    matches = sorted(CACHE_DIR.glob(f"{_key(source, query)}__*.json"))
    if not matches:
        return None
    path = matches[-1]  # timestamp is in the name, so lexical sort == newest
    if max_age_hours is not None:
        age_h = (datetime.now(timezone.utc).timestamp() - path.stat().st_mtime) / 3600
        if age_h > max_age_hours:
            log.info("cache stale (%.1fh) for %s %r", age_h, source, query)
            return None
    return path


def load(source: str, query: str, max_age_hours: float | None = None) -> dict | None:
    path = newest(source, query, max_age_hours)
    if path is None:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("unreadable cache file %s: %s", path.name, exc)
        return None


def save(source: str, query: str, payload: dict) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = CACHE_DIR / f"{_key(source, query)}__{stamp}.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def fetch_json(
    url: str,
    params: dict,
    *,
    source: str,
    query: str,
    fresh: bool = False,
    timeout: int = DEFAULT_TIMEOUT,
    max_age_hours: float | None = None,
) -> tuple[dict, bool]:
    """Cached GET. Returns (payload, from_cache). Raises only on a live failure."""
    global HITS, MISSES

    if not fresh:
        cached = load(source, query, max_age_hours)
        if cached is not None:
            HITS += 1
            log.info("cache HIT  %s %r", source, query)
            return cached, True

    log.info("cache MISS %s %r - calling live API", source, query)
    resp = requests.get(url, params=params, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    MISSES += 1
    path = save(source, query, payload)
    log.info("saved raw response -> %s", path.name)
    return payload, False
