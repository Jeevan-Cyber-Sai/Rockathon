"""Entry point: fetch, clean, and dedupe listings for a query.

    python scripts/fetch.py "laptop 16GB RAM 512GB SSD"
    python scripts/fetch.py "laptop 16GB RAM 512GB SSD" --fresh

No PRODUCT_API_KEY -> falls back to data/fixtures/laptops.json, filtered on
whatever RAM/storage numbers appear in the query.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core import cache, normalise  # noqa: E402
from core.adapter import build_all  # noqa: E402
from core.dedupe import dedupe_stats, group_listings  # noqa: E402
from core.models import Listing  # noqa: E402

log = logging.getLogger("fetch")

FIXTURES_PATH = Path(__file__).resolve().parent.parent / "data" / "fixtures" / "laptops.json"


def load_fixtures(query: str) -> list[Listing]:
    if not FIXTURES_PATH.exists():
        print(f"no fixtures at {FIXTURES_PATH} - run scripts/make_fixtures.py first")
        return []

    raw = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    listings = [Listing(**row) for row in raw]

    wanted_ram = normalise.parse_ram_gb(query)
    wanted_storage, _ = normalise.parse_storage(query)
    if wanted_ram:
        listings = [l for l in listings if l.ram_gb == wanted_ram] or listings
    if wanted_storage:
        listings = [l for l in listings if l.storage_gb == wanted_storage] or listings
    return listings


def fetch_all(query: str, fresh: bool) -> tuple[list[Listing], bool]:
    """Returns (listings, used_fixtures)."""
    if not os.getenv("PRODUCT_API_KEY"):
        print("PRODUCT_API_KEY is not set - using fixtures (data/fixtures/laptops.json).")
        print("  Set it in .env to fetch live listings. See .env.example.\n")
        return load_fixtures(query), True

    cache.reset_stats()
    adapters = build_all(fresh=fresh)
    if not adapters:
        print("no usable adapters (see warnings above) - falling back to fixtures.\n")
        return load_fixtures(query), True

    listings: list[Listing] = []
    for a in adapters:
        found = a.search(query)
        print(f"  {a.name}: {len(found)} listings "
              f"({'live' if cache.MISSES else 'cache'} this call)")
        listings.extend(found)
    return listings, False


def truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def print_table(listings: list[Listing]) -> None:
    headers = ("source", "title", "price", "ram", "storage", "delivery", "rating")
    widths = (17, 46, 10, 5, 9, 9, 7)
    print("  " + "".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  " + "-" * (sum(widths)))
    for l in sorted(listings, key=lambda x: x.price):
        row = (
            truncate(l.source, widths[0] - 2),
            truncate(l.title, widths[1] - 2),
            f"Rs {l.price:,}",
            str(l.ram_gb or "-"),
            f"{l.storage_gb}{l.storage_type or ''}" if l.storage_gb else "-",
            f"{l.delivery_days}d" if l.delivery_days else "-",
            str(l.rating or "-"),
        )
        print("  " + "".join(str(c).ljust(w) for c, w in zip(row, widths)))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help='e.g. "laptop 16GB RAM 512GB SSD"')
    parser.add_argument("--fresh", action="store_true", help="bypass the cache")
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    normalise.reset_stats()
    listings, used_fixtures = fetch_all(args.query, args.fresh)

    if not listings:
        print("No listings found.")
        return 1

    groups = group_listings(listings)
    print_table(listings)

    stats = dedupe_stats(len(listings), groups)
    pstats = normalise.STATS
    cache_hits, cache_misses = cache.HITS, cache.MISSES

    print()
    print(f"summary: {stats['raw']} raw listings -> {stats['groups']} products after dedupe "
          f"({stats['merged_listings']} listings merged into {stats['merged_groups']} groups)")
    if used_fixtures:
        print("  source: fixtures (no PRODUCT_API_KEY)")
    else:
        print(f"  source: {cache_hits} query/queries from cache, {cache_misses} live")
    print(f"  spec parse failures: ram={pstats.ram_failed} storage={pstats.storage_failed} "
          f"delivery={pstats.delivery_failed} processor={pstats.processor_failed} "
          f"(total {pstats.total_failed})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
