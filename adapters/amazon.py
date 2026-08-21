"""Amazon.in listings via Rainforest API (licensed product data, not scraping).

Everything Amazon-shaped lives in this file. The rest of the app only knows
about VendorAdapter and Listing.

Docs: https://www.rainforestapi.com/docs/product-data-api/results/search
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from pydantic import ValidationError

from core import cache, normalise
from core.adapter import AdapterUnavailable, VendorAdapter
from core.models import Listing, utcnow

log = logging.getLogger("adapters.amazon")

load_dotenv()

ENDPOINT = "https://api.rainforestapi.com/request"


class AmazonAdapter(VendorAdapter):
    name = "amazon"

    def __init__(self, fresh: bool = False, domain: str = "amazon.in"):
        self.api_key = os.getenv("PRODUCT_API_KEY")
        if not self.api_key:
            raise AdapterUnavailable(
                "PRODUCT_API_KEY is not set - add it to .env (see .env.example). "
                "Falling back to fixtures."
            )
        self.fresh = fresh
        self.domain = domain

    # --- fetching -----------------------------------------------------------

    def search(self, query: str, max_results: int = 30) -> list[Listing]:
        """Never raises. An empty list means we got nothing usable.

        Amazon's own search results page holds ~16 listings, so one request
        cannot reach max_results=30 on its own. Extra pages are each cached
        under their own key (query + page), so a repeat call for the same
        query still makes zero network calls.
        """
        listings: list[Listing] = []
        page = 1
        while len(listings) < max_results:
            results, from_cache = self._search_page(query, page)
            if results is None:
                break  # a failed page stops pagination, keeps what we have
            log.info("amazon %r page %d -> %d raw results (%s)", query, page,
                     len(results), "cache" if from_cache else "live")

            for raw in results:
                listing = self._to_listing(raw)
                if listing is not None:
                    listings.append(listing)

            if len(results) < 16 or page >= 3:  # short page or safety cap: no more results
                break
            page += 1

        return listings[:max_results]

    def _search_page(self, query: str, page: int) -> tuple[list[dict] | None, bool]:
        cache_query = query if page == 1 else f"{query}::page{page}"
        try:
            payload, from_cache = cache.fetch_json(
                ENDPOINT,
                {
                    "api_key": self.api_key,
                    "type": "search",
                    "amazon_domain": self.domain,
                    "search_term": query,
                    # No category_id: this adapter now searches every product
                    # category, not just computers. The search_term itself
                    # (built from product_type) carries enough specificity for
                    # Amazon's own relevance ranking to surface the right
                    # results, laptops included.
                    "sort_by": "price_low_to_high",
                    "page": page,
                },
                source=self.name,
                query=cache_query,
                fresh=self.fresh,
            )
        except Exception as exc:
            log.warning("amazon search failed for %r page %d: %s", query, page, exc)
            return None, False

        results = payload.get("search_results") or []
        if not isinstance(results, list):
            log.warning("unexpected search_results shape: %s", type(results).__name__)
            return None, from_cache
        return results, from_cache

    # --- mapping ------------------------------------------------------------

    def _to_listing(self, raw: dict) -> Listing | None:
        """One search result -> one Listing. Any missing field is survivable."""
        if not isinstance(raw, dict):
            return None

        asin = _first(raw, "asin", "id", "product_id")
        title = _first(raw, "title", "name")
        url = _first(raw, "link", "url")
        price = _price(raw)

        # Without these there is nothing to compare or buy.
        if not (asin and title and url and price):
            log.debug("skipping result with missing identity fields: %s", str(raw)[:120])
            return None

        specs = normalise.parse_specs(title, _spec_blob(raw))

        try:
            return Listing(
                source=self.name,
                product_id=str(asin),
                title=str(title),
                url=str(url),
                price=price,
                image_url=_first(raw, "image", "image_url", "thumbnail"),
                delivery_days=_delivery(raw),
                rating=raw.get("rating"),
                rating_count=_first(raw, "ratings_total", "reviews_total", "ratings_count"),
                stock=_stock(raw),
                fetched_at=utcnow(),
                **specs,
            )
        except ValidationError as exc:
            # One bad row must not cost us the other 29.
            log.warning("dropping %s: %s", asin, exc.errors()[0].get("msg"))
            return None


# --- field digging ----------------------------------------------------------
# Rainforest is generally consistent, but keys move between result types and
# some fields simply are not present for every listing.


def _first(raw: dict, *keys):
    for key in keys:
        value = raw.get(key)
        if value not in (None, "", []):
            return value
    return None


def _price(raw: dict) -> int | None:
    """price.value is rupees as a float; price.raw is a string like 'Rs 45,999'."""
    block = raw.get("price")
    if isinstance(block, dict):
        for key in ("value", "raw"):
            if block.get(key) not in (None, ""):
                return block[key]          # the Listing validator does the cleanup
    for key in ("price", "current_price", "price_lower"):
        value = raw.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return value
        if isinstance(value, str) and any(c.isdigit() for c in value):
            return value
    prices = raw.get("prices")
    if isinstance(prices, list) and prices and isinstance(prices[0], dict):
        return prices[0].get("value") or prices[0].get("raw")
    return None


def _delivery(raw: dict) -> int | None:
    """Delivery text lives in several places and often nowhere at all."""
    block = raw.get("delivery")
    candidates = []
    if isinstance(block, dict):
        candidates += [block.get("tagline"), block.get("fastest_delivery"),
                       block.get("from"), block.get("price_raw")]
        for key in ("fastest", "standard"):
            inner = block.get(key)
            if isinstance(inner, dict):
                candidates.append(inner.get("date") or inner.get("raw"))
    elif isinstance(block, str):
        candidates.append(block)
    candidates += [raw.get("shipping_message"), raw.get("availability_raw")]

    for text in candidates:
        if not text:
            continue
        days = normalise.parse_delivery_days(str(text))
        if days is not None:
            return days
    return None  # unknown, not 0


def _stock(raw: dict) -> int | None:
    availability = raw.get("availability")
    text = ""
    if isinstance(availability, dict):
        text = str(availability.get("raw") or availability.get("type") or "")
    elif isinstance(availability, str):
        text = availability
    low = text.lower()

    if any(w in low for w in ("out of stock", "unavailable", "currently not available")):
        return 0
    if "only" in low:
        import re
        m = re.search(r"only\s+(\d+)\s+left", low)
        if m:
            return int(m.group(1))
    return None  # "In stock" tells us nothing about quantity


def _spec_blob(raw: dict) -> str:
    """Flatten any structured spec fields so the parsers can see them too."""
    parts: list[str] = []
    for key in ("specifications", "attributes", "feature_bullets", "features",
                "bullet_points", "specs"):
        value = raw.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    parts.append(f"{item.get('name', '')} {item.get('value', '')}")
                elif isinstance(item, str):
                    parts.append(item)
        elif isinstance(value, dict):
            parts += [f"{k} {v}" for k, v in value.items()]
        elif isinstance(value, str):
            parts.append(value)
    return " ".join(p.strip() for p in parts if p and p.strip())
