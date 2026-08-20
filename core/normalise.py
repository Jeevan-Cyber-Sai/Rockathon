"""Turning what retailers wrote into what the decision engine can compare.

Every function here returns None on failure and logs the string it choked on.
Silent failure is worse than no data: a missing RAM value we can see is a bug we
can fix, a missing RAM value we cannot see is a bad purchase.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

log = logging.getLogger("normalise")

# Plausible real-world values, used to tell a RAM number from a storage number
# when the title gives no other clue ("HP 15, 8GB, 512GB SSD").
RAM_SIZES = {2, 3, 4, 6, 8, 12, 16, 18, 24, 32, 36, 48, 64, 96, 128}
STORAGE_SIZES = {32, 64, 128, 256, 512, 1024, 2048, 4096}

SSD_WORDS = ("ssd", "nvme", "m.2", "m2 ", "pcie", "emmc", "solid state")
HDD_WORDS = ("hdd", "hard disk", "hard drive", "sata hdd", "5400rpm", "7200rpm")

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# Full names and common abbreviations only, each an exact token - not "mon" as a
# prefix, which would also match "month", "monitor", "money" and the like.
_WEEKDAY_INDEX = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}
_WEEKDAY_RE = re.compile(
    r"\b(" + "|".join(sorted(_WEEKDAY_INDEX, key=len, reverse=True)) + r")\b", re.I)


@dataclass
class ParseStats:
    """Honest tally for the fetch.py summary. Reset per run."""

    ram_failed: int = 0
    storage_failed: int = 0
    delivery_failed: int = 0
    processor_failed: int = 0
    samples: list[tuple[str, str]] = field(default_factory=list)

    @property
    def total_failed(self) -> int:
        return (self.ram_failed + self.storage_failed
                + self.delivery_failed + self.processor_failed)

    def miss(self, field_name: str, raw: str | None) -> None:
        setattr(self, f"{field_name}_failed", getattr(self, f"{field_name}_failed") + 1)
        log.info("could not parse %s from %r", field_name, raw)
        if len(self.samples) < 20:
            self.samples.append((field_name, (raw or "")[:70]))


STATS = ParseStats()


def reset_stats() -> ParseStats:
    global STATS
    STATS = ParseStats()
    return STATS


def _text(value) -> str:
    return value if isinstance(value, str) else ("" if value is None else str(value))


# --- RAM --------------------------------------------------------------------

_RAM_PATTERNS = (
    re.compile(r"(\d{1,3})\s*gb\s*(?:lp)?ddr\s*\d?[a-z0-9]*", re.I),       # 16 GB DDR4
    re.compile(r"(\d{1,3})\s*gb\s*(?:unified\s+)?(?:ram|memory)", re.I),   # 16GB RAM
    re.compile(r"ram[\s:]*(\d{1,3})\s*gb", re.I),                          # RAM: 16GB
    re.compile(r"(\d{1,3})\s*gb\s*(?:onboard|soldered|expandable)", re.I),
)
_SIZE_TOKEN = re.compile(r"(\d{1,4})\s*(gb|tb)\b", re.I)


@dataclass
class _SizeToken:
    gb: int
    unit: str
    context: str   # text after the size, stopping at the NEXT size


def _size_tokens(s: str) -> list[_SizeToken]:
    """Split '16GB RAM/512GB SSD' into its sizes, each with only its own words.

    The context must stop at the next size token. Reading past it is what made
    the 16 in "16GB RAM/512GB SSD" look like an SSD.
    """
    matches = list(_SIZE_TOKEN.finditer(s))
    tokens = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(s)
        value, unit = int(m.group(1)), m.group(2).lower()
        tokens.append(_SizeToken(
            gb=value * 1024 if unit == "tb" else value,
            unit=unit,
            context=s[m.end():min(end, m.end() + 25)],
        ))
    return tokens


def parse_ram_gb(text: str | None) -> int | None:
    """'16 GB' / '16GB' / '16gb RAM' / '16 GB DDR4' -> 16."""
    s = _text(text)
    if not s:
        STATS.miss("ram", text)
        return None

    for pattern in _RAM_PATTERNS:
        m = pattern.search(s)
        if m and int(m.group(1)) in RAM_SIZES:
            return int(m.group(1))

    # No RAM keyword anywhere ("8GB/512GB SSD"): take the first size that could
    # only be RAM - not a terabyte, not labelled as a disk, not a disk size.
    for token in _size_tokens(s):
        if token.unit == "tb":
            continue  # nobody ships a terabyte of RAM in a Rs 45k laptop
        if parse_storage_type(token.context) is not None:
            continue  # that one is storage
        if token.gb in RAM_SIZES and token.gb not in (32, 64, 128):
            return token.gb  # sizes plausible as either are left to storage
    STATS.miss("ram", text)
    return None


def parse_ram_gb_quiet(text: str | None) -> int | None:
    """parse_ram_gb without touching the failure counters (used internally)."""
    global STATS
    saved, STATS = STATS, ParseStats()
    try:
        return parse_ram_gb(text)
    finally:
        STATS = saved


# --- storage ----------------------------------------------------------------


def parse_storage_type(text: str | None) -> str | None:
    s = _text(text).lower()
    if any(w in s for w in SSD_WORDS):
        return "SSD"   # dual-drive machines are compared on their SSD
    if any(w in s for w in HDD_WORDS):
        return "HDD"
    return None


def parse_storage(text: str | None) -> tuple[int | None, str | None]:
    """'512GB M.2 SSD' -> (512, SSD). '1TB HDD' -> (1024, HDD). '1 TB' -> (1024, None)."""
    s = _text(text)
    if not s:
        STATS.miss("storage", text)
        return None, None

    ram = parse_ram_gb_quiet(s)
    typed: tuple[int, str] | None = None      # a size with a type next to it
    untyped: int | None = None                # a bare size, e.g. "1 TB"

    for token in _size_tokens(s):
        gb, kind = token.gb, parse_storage_type(token.context)
        plausible = token.unit == "tb" or gb in STORAGE_SIZES

        if kind is not None and plausible and gb != ram:
            # Prefer SSD on dual-drive machines; that is what buyers compare.
            if typed is None or (kind == "SSD" and typed[1] == "HDD"):
                typed = (gb, kind)
        elif kind is None and untyped is None and plausible and gb != ram:
            untyped = gb

    if typed is not None:
        return typed
    if untyped is not None:
        return untyped, parse_storage_type(s)

    STATS.miss("storage", text)
    return None, None


# --- delivery ---------------------------------------------------------------

_RANGE = re.compile(r"(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*(?:business\s+|working\s+)?days?", re.I)
_SINGLE = re.compile(r"(?:in|within|by)?\s*(\d{1,2})\s*(?:business\s+|working\s+)?days?", re.I)
_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_DMY = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b")
_DAY_MONTH = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b", re.I)
_MONTH_DAY = re.compile(r"\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b", re.I)


def parse_delivery_days(text: str | None, today: date | None = None) -> int | None:
    """'2-4 days' -> 4 (pessimistic end). 'Tomorrow' -> 1. A date -> days from today."""
    s = _text(text).strip()
    today = today or datetime.now(timezone.utc).date()
    if not s:
        STATS.miss("delivery", text)
        return None

    low = s.lower()

    # "FREE delivery Sat, 22 Aug Or fastest delivery Tomorrow, 21 Aug" - the
    # fastest option is usually paid or Prime-only. Quote the standard promise;
    # promising tomorrow and delivering Saturday is how a deadline gets missed.
    m = re.search(r"\bor\s+(?:get\s+it\s+)?fastest\b", low)
    if m:
        low = low[:m.start()]

    # 0 is reserved for "no data", which is None, so same-day counts as 1.
    if any(w in low for w in ("today", "same day", "same-day", "tonight", "few hours")):
        return 1
    if any(w in low for w in ("tomorrow", "overnight", "next day")):
        return 1

    m = _RANGE.search(low)
    if m:
        return max(int(m.group(1)), int(m.group(2)))  # pessimistic end

    m = _SINGLE.search(low)
    if m:
        return max(int(m.group(1)), 1)

    target = _parse_date(low, today)
    if target is not None:
        days = (target - today).days
        # Nobody promises delivery a quarter of a year out. A date that lands
        # that far away is a stale or misread feed, not a delivery estimate.
        if days < 0 or days > 90:
            STATS.miss("delivery", text)
            return None
        return days or 1

    m = _WEEKDAY_RE.search(low)
    if m:
        idx = _WEEKDAY_INDEX[m.group(1).lower()]
        delta = (idx - today.weekday()) % 7
        return delta or 7  # "Monday" on a Monday means next Monday

    STATS.miss("delivery", text)
    return None


def _parse_date(low: str, today: date) -> date | None:
    m = _ISO.search(low)
    if m:
        return _safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    m = _DMY.search(low)
    if m:
        day, month, year = (int(g) for g in m.groups())
        year += 2000 if year < 100 else 0
        return _safe_date(year, month, day)

    for pattern, order in ((_DAY_MONTH, "dm"), (_MONTH_DAY, "md")):
        m = pattern.search(low)
        if not m:
            continue
        day_s, mon_s = (m.group(1), m.group(2)) if order == "dm" else (m.group(2), m.group(1))
        month = MONTHS.get(mon_s[:3].lower())
        if month is None:
            continue
        found = _safe_date(today.year, month, int(day_s))
        if found and found < today:
            found = _safe_date(today.year + 1, month, int(day_s))  # December -> January
        return found
    return None


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


# --- processor --------------------------------------------------------------

_CPU_PATTERNS = (
    (re.compile(r"core\s*ultra\s*([579])\s*(\d{3}[a-z]{0,2})?", re.I),
     lambda m: f"Intel Core Ultra {m.group(1)}" + (f" {m.group(2).upper()}" if m.group(2) else "")),
    (re.compile(r"(?:intel\s*)?core\s*(i[3579])[\s\-]*(\d{4,5}[a-z]{0,2})?", re.I),
     lambda m: f"Intel Core {m.group(1).lower()}"
               + (f"-{m.group(2).upper()}" if m.group(2) else "")),
    # Retailers often drop the word "Core": "Dell Inspiron, Intel i5-1235U".
    (re.compile(r"\b(i[3579])-(\d{4,5}[a-z]{0,2})\b", re.I),
     lambda m: f"Intel Core {m.group(1).lower()}-{m.group(2).upper()}"),
    (re.compile(r"ryzen\s*([3579])\s*(\d{4}[a-z]{0,2})?", re.I),
     lambda m: f"AMD Ryzen {m.group(1)}" + (f" {m.group(2).upper()}" if m.group(2) else "")),
    (re.compile(r"\bapple\s+m([1-4])\s*(pro|max|ultra)?\b", re.I),
     lambda m: f"Apple M{m.group(1)}" + (f" {m.group(2).title()}" if m.group(2) else "")),
    (re.compile(r"\bm([1-4])\s+(pro|max|ultra)\b", re.I),
     lambda m: f"Apple M{m.group(1)} {m.group(2).title()}"),
    # "MacBook Air with M2 chip" - the brand and the chip are not adjacent.
    (re.compile(r"\bm([1-4])\s*(?:chip|processor)\b", re.I),
     lambda m: f"Apple M{m.group(1)}"),
    (re.compile(r"\bmacbook\b[^,]{0,40}?\bm([1-4])\b", re.I),
     lambda m: f"Apple M{m.group(1)}"),
    (re.compile(r"\b(celeron|pentium)\b", re.I), lambda m: f"Intel {m.group(1).title()}"),
    (re.compile(r"\b(athlon)\b", re.I), lambda m: f"AMD {m.group(1).title()}"),
    (re.compile(r"\bintel\s+(n\d{3,4})\b", re.I), lambda m: f"Intel {m.group(1).upper()}"),
    (re.compile(r"\b(snapdragon|mediatek)\s*([a-z0-9]{1,8})?", re.I),
     lambda m: f"{m.group(1).title()}" + (f" {m.group(2).upper()}" if m.group(2) else "")),
)


def parse_processor(text: str | None) -> str | None:
    s = _text(text)
    for pattern, render in _CPU_PATTERNS:
        m = pattern.search(s)
        if m:
            return render(m).strip()
    STATS.miss("processor", text)
    return None


# --- title normalisation (for dedupe) --------------------------------------

_NOISE = re.compile(
    r"\b(\d{1,4}\s*(?:gb|tb)|ssd|hdd|nvme|m\.2|emmc|ddr\d\w*|lpddr\d\w*|ram|memory"
    r"|windows\s*1[01]\s*(?:home|pro)?|ms\s*office|office\s*20\d\d|w11|win\s*11"
    r"|thin\s*(?:and|&)\s*light|laptop|notebook|gaming|backlit|keyboard|fhd|full\s*hd"
    r"|ips|display|inch(?:es)?|cm|graphics|gpu|warranty|year|alexa|built[\s\-]?in"
    r"|with|and|for|the|new|latest|20\d\d\s*model)\b", re.I)


def normalise_title(text: str | None) -> str:
    """Strip specs and marketing so two titles for one laptop look alike."""
    # Sellers write brand names in maths-bold to dodge filters ("Lenovo" as
    # U+1D5DF...). NFKC folds those back to ASCII; without it the brand is
    # stripped as punctuation and dedupe compares a laptop against nothing.
    s = unicodedata.normalize("NFKC", _text(text)).lower()
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s)     # bracketed marketing
    s = re.sub(r"[₹$]|rs\.?\s*\d[\d,]*", " ", s)
    s = re.sub(r"\b\d{1,2}\.\d\b", " ", s)          # screen sizes: 15.6
    s = _NOISE.sub(" ", s)
    s = re.sub(r"[^a-z0-9\s\-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_specs(title: str | None, extra: str | None = None) -> dict:
    """Everything we can get from free text, in Listing field names."""
    blob = " ".join(t for t in (title, extra) if t)
    storage_gb, storage_type = parse_storage(blob)
    return {
        "ram_gb": parse_ram_gb(blob),
        "storage_gb": storage_gb,
        "storage_type": storage_type,
        "processor": parse_processor(blob),
    }
