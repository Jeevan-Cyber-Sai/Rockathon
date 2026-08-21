"""QuickCommerce API - search across Indian quick-commerce/e-commerce
marketplaces (BlinkIt, Zepto, Swiggy, BigBasket, DMart, JioMart, Minutes,
Amazon, Nykaa, Myntra, Flipkart) through one aggregator.

Everything QuickCommerce-shaped lives in this file. The rest of the app
only knows about VendorAdapter and Listing - same rule as amazon.py.

Docs given for this integration (no public URL to link, unlike Rainforest):
  Base:      https://api.quickcommerceapi.com
  Auth:      X-API-Key header
  Search:    GET /v1/search        - q, lat, lon, platform, pincode(optional)
  Platforms: GET /v1/supported-platforms  - free, no key required
  Credits:   GET /v1/credits

Two things this adapter deliberately does NOT do, both by design, not
oversight:

1. Guess your location. Every QuickCommerce search is lat/lon-gated. Shopyx
   has no location-collection anywhere yet, so unless a caller explicitly
   passes lat/lon into search(), this adapter contributes nothing and logs
   why - never a fabricated coordinate.
2. Call all 11 platforms by default. Each platform is its own billed
   request. search() requires an explicit, non-empty `platforms` list; with
   none given it returns [] rather than guessing which marketplaces you
   wanted charged.
"""

from __future__ import annotations

import logging
import os
import re

import requests
from dotenv import load_dotenv
from pydantic import ValidationError

from core import cache, normalise
from core.adapter import AdapterUnavailable, VendorAdapter
from core.models import Listing, utcnow

log = logging.getLogger("adapters.quickcommerce")

load_dotenv()

DEFAULT_BASE_URL = "https://api.quickcommerceapi.com"

# Fallback only - used when the live /v1/supported-platforms call itself
# fails (it's free/keyless, so failure means the service or network is down,
# not a credits problem). Kept explicitly separate from anything a user
# supplies: this never overrides a live discovery result, it only backstops
# validation when discovery is unavailable. Names as given in the brief;
# matching against a caller's platform string is case-insensitive.
KNOWN_PLATFORMS = (
    "BlinkIt", "Zepto", "Swiggy", "BigBasket", "DMart", "JioMart",
    "Minutes", "Amazon", "Nykaa", "Myntra", "Flipkart",
)

# Per the brief: these three require pincode specifically, not just lat/lon.
PINCODE_REQUIRED_PLATFORMS = {"dmart", "jiomart", "minutes"}


class QuickCommerceAdapter(VendorAdapter):
    name = "quickcommerce"

    def __init__(self, fresh: bool = False, base_url: str | None = None):
        self.api_key = os.getenv("QUICKCOMMERCE_API_KEY")
        if not self.api_key:
            raise AdapterUnavailable(
                "QUICKCOMMERCE_API_KEY is not set - add it to .env (see .env.example). "
                "Amazon/Rainforest is unaffected."
            )
        self.base_url = (base_url or os.getenv("QUICKCOMMERCE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.fresh = fresh

    # --- platform discovery / validation -------------------------------------

    def _resolve_platforms(self, requested: list[str]) -> list[str]:
        """Requested platform names -> the subset that's actually supported,
        matched case-insensitively against live discovery (falling back to
        KNOWN_PLATFORMS if that call fails). Unsupported names are dropped
        with a warning, not fatal to the rest of the request."""
        supported = fetch_supported_platforms(base_url=self.base_url) or list(KNOWN_PLATFORMS)
        by_lower = {p.lower(): p for p in supported}

        resolved = []
        for name in requested:
            canonical = by_lower.get(str(name).strip().lower())
            if canonical is None:
                log.warning("quickcommerce: unsupported platform %r (supported: %s) - skipped",
                           name, ", ".join(supported))
                continue
            resolved.append(canonical)
        return resolved

    # --- fetching -------------------------------------------------------------

    def search(self, query: str, max_results: int = 30, *,
               lat: float | None = None, lon: float | None = None,
               pincode: str | None = None, platforms: list[str] | None = None,
               **_ignored) -> list[Listing]:
        """Never raises. An empty list means either nothing usable came back,
        or (far more often, by design) the call didn't have what it needed
        to safely run at all - see the two rules in the module docstring.

        Each requested platform is one billed request. A failure on one
        platform (timeout, 401, malformed response, that marketplace being
        down) is caught and logged per-platform; it never stops the others
        from returning results, and never propagates to Amazon/Rainforest.
        """
        if not platforms:
            log.info("quickcommerce: no platforms requested - skipping (never calls all %d by default)",
                     len(KNOWN_PLATFORMS))
            return []
        if lat is None or lon is None:
            log.warning("quickcommerce: search for %r requested platforms %s but no lat/lon was "
                       "supplied - skipping rather than guessing a location", query, platforms)
            return []

        resolved = self._resolve_platforms(platforms)
        if not resolved:
            return []

        listings: list[Listing] = []
        for platform in resolved:
            plat_key = platform.lower()
            if plat_key in PINCODE_REQUIRED_PLATFORMS and not pincode:
                log.warning("quickcommerce: platform %s requires pincode, none supplied - "
                           "skipping this platform only", platform)
                continue
            try:
                listings.extend(self._search_platform(query, lat, lon, platform, pincode))
            except Exception as exc:
                # Belt and suspenders: _search_platform already catches its
                # own request errors, but a normalisation bug here must still
                # not take out the other platforms in this loop.
                log.warning("quickcommerce: platform %s failed unexpectedly for %r: %s",
                           platform, query, exc)
                continue

        return listings[:max_results]

    def _search_platform(self, query: str, lat: float, lon: float,
                          platform: str, pincode: str | None) -> list[Listing]:
        params = {"q": query, "lat": lat, "lon": lon, "platform": platform}
        if pincode:
            params["pincode"] = pincode
        # Cache key includes every param that changes the actual request -
        # same query at a different location, or a different platform, must
        # never share a cache entry (and must never silently skip a billed
        # call because of a same-query-different-location collision).
        cache_query = f"{query}::{platform}::{lat}::{lon}::{pincode or ''}"

        try:
            payload, from_cache = cache.fetch_json(
                f"{self.base_url}/v1/search",
                params,
                source=self.name,
                query=cache_query,
                fresh=self.fresh,
                headers={"X-API-Key": self.api_key},
            )
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 401:
                log.warning("quickcommerce: invalid API key (401) on platform %s - "
                           "check QUICKCOMMERCE_API_KEY", platform)
            elif status in (402, 429):
                log.warning("quickcommerce: platform %s rejected (status %s) - likely "
                           "insufficient credits or rate limit", platform, status)
            elif status == 400:
                log.warning("quickcommerce: platform %s returned 400 (invalid request) for %r",
                           platform, query)
            else:
                log.warning("quickcommerce: platform %s HTTP error (status %s) for %r",
                           platform, status, query)
            return []
        except requests.Timeout:
            log.warning("quickcommerce: platform %s timed out for %r", platform, query)
            return []
        except requests.ConnectionError as exc:
            log.warning("quickcommerce: platform %s connection error for %r: %s", platform, query, exc)
            return []
        except requests.RequestException as exc:
            log.warning("quickcommerce: platform %s request failed for %r: %s", platform, query, exc)
            return []
        except ValueError as exc:  # payload wasn't valid JSON
            log.warning("quickcommerce: platform %s returned malformed JSON for %r: %s",
                       platform, query, exc)
            return []

        results = _extract_results(payload)
        if results is None:
            log.warning("quickcommerce: platform %s - unrecognised response shape, keys=%s",
                       platform, list(payload.keys()) if isinstance(payload, dict) else type(payload).__name__)
            return []

        log.info("quickcommerce %r platform=%s -> %d raw results (%s)",
                 query, platform, len(results), "cache" if from_cache else "live")

        out = []
        for raw in results:
            listing = self._to_listing(raw, platform)
            if listing is not None:
                out.append(listing)
        return out

    # --- mapping ---------------------------------------------------------------

    def _to_listing(self, raw: dict, platform: str) -> Listing | None:
        """One search result -> one Listing. Any missing field is survivable
        except identity/price, same policy as the Amazon adapter."""
        if not isinstance(raw, dict):
            return None

        product_id = raw.get("id")
        title = raw.get("name")
        url = raw.get("deeplink")
        price = _price(raw)

        if not (product_id and title and url and price):
            log.debug("quickcommerce: skipping result with missing identity fields: %s", str(raw)[:120])
            return None

        specs = normalise.parse_specs(str(title), None)

        try:
            return Listing(
                source=self.name,           # provider: "quickcommerce"
                platform=platform,          # marketplace: "Flipkart", "Myntra", ...
                product_id=str(product_id),
                title=str(title),
                url=str(url),
                price=price,
                mrp=raw.get("mrp"),
                brand=raw.get("brand"),
                pack_size=raw.get("quantity"),
                image_url=_first_image(raw.get("images")),
                delivery_days=_delivery_days(raw),
                rating=raw.get("rating"),
                rating_count=raw.get("rating_count"),
                stock=_stock(raw),
                fetched_at=utcnow(),
                **specs,
            )
        except ValidationError as exc:
            log.warning("quickcommerce: dropping %s (%s): %s", product_id, platform,
                       exc.errors()[0].get("msg"))
            return None


# --- module-level helpers: usable without an API key / adapter instance -----


def fetch_supported_platforms(base_url: str | None = None, fresh: bool = False) -> list[str] | None:
    """GET /v1/supported-platforms - free, no API key, per the docs. Returns
    None (never raises) if the call fails, so callers fall back to the
    hardcoded KNOWN_PLATFORMS list rather than breaking."""
    url = (base_url or os.getenv("QUICKCOMMERCE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    try:
        payload, _ = cache.fetch_json(
            f"{url}/v1/supported-platforms", {},
            source="quickcommerce_platforms", query="supported-platforms",
            fresh=fresh, max_age_hours=24,  # this list changes rarely; a day-old cache is fine
        )
    except Exception as exc:
        log.info("quickcommerce: could not fetch supported platforms live (%s) - using fallback list", exc)
        return None

    if isinstance(payload, list):
        return [str(p) for p in payload]
    if isinstance(payload, dict):
        for key in ("platforms", "supported_platforms", "data", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return [str(p) for p in value]
    log.info("quickcommerce: unrecognised /v1/supported-platforms response shape - using fallback list")
    return None


def fetch_credits(base_url: str | None = None) -> dict | None:
    """GET /v1/credits - for a caller (e.g. an ops script) that wants to
    check remaining balance before running something credit-heavy. Not
    called anywhere in the search path itself."""
    api_key = os.getenv("QUICKCOMMERCE_API_KEY")
    if not api_key:
        return None
    url = (base_url or os.getenv("QUICKCOMMERCE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    try:
        resp = requests.get(f"{url}/v1/credits", headers={"X-API-Key": api_key}, timeout=cache.DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        log.warning("quickcommerce: could not fetch credits: %s", exc)
        return None


# --- field digging ------------------------------------------------------------
# Verified against one real /v1/search response (Flipkart, 21 Aug 2026):
# {"status": "success", "request_id": ..., "credits_remaining": N,
#  "data": {"query": ..., "platform": ..., "total_results": N,
#            "products": [{...}]}}
# The per-product fields (id, name, brand, mrp, offer_price, quantity,
# deeplink, rating, rating_count, inventory, images) matched the brief
# exactly. One thing the brief didn't mention: each product's own
# "platform" field is a nested object ({"name", "sla", "open", "icon"}),
# not a string - sla is real delivery-estimate text ("Delivery by 26th
# Aug"), read below. is_ad/rank/store_id also come back but aren't mapped -
# not required by the product schema and not asked for.
#
# The wrapper-key fallbacks below stay in place (not just data.products)
# in case a different platform or a future API version answers with a
# flatter shape - this was checked against exactly one platform, not all 11.


def _extract_results(payload) -> list[dict] | None:
    """The documented fields (id, name, brand, ...) describe one result row,
    not the envelope around the list of them. Handles the real shape
    (payload["data"]["products"]), a bare list, and the flatter wrapper-key
    shapes some APIs use instead. Returns None (not []) when nothing
    recognisable is found, so the caller can tell "no results" apart from
    "wrong shape"."""
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return None

    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("products", "results", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return value

    for key in ("results", "products", "items", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return None


def _price(raw: dict) -> int | None:
    price = raw.get("offer_price")
    if price in (None, "", 0):
        price = raw.get("mrp")
    return price


def _first_image(images) -> str | None:
    if isinstance(images, list) and images:
        return images[0]
    if isinstance(images, str):
        return images
    return None


def _stock(raw: dict) -> int | None:
    if raw.get("available") is False:
        return 0
    inventory = raw.get("inventory")
    if isinstance(inventory, bool):
        return None  # not a count
    if isinstance(inventory, (int, float)) and inventory >= 0:
        return int(inventory)
    if isinstance(inventory, str):
        digits = re.sub(r"[^\d]", "", inventory)
        if digits:
            return int(digits)
    return None  # available (or unknown) with no count - unknown quantity, not zero


def _delivery_days(raw: dict) -> int | None:
    """Real field, verified: raw["platform"]["sla"] is free text like
    "Delivery by 26th Aug" - parsed with the same date/relative-text parser
    amazon.py already relies on for the same kind of text. The other
    candidate keys are kept as a defensive fallback in case a different
    platform answers with a flatter shape; None (unknown) if nothing
    parses, never guessed."""
    platform_block = raw.get("platform")
    if isinstance(platform_block, dict):
        sla = platform_block.get("sla")
        if isinstance(sla, str):
            days = normalise.parse_delivery_days(sla)
            if days is not None:
                return days

    for key in ("delivery_days", "eta_days", "delivery_eta", "eta", "sla"):
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            days = normalise.parse_delivery_days(value)
            if days is not None:
                return days
    return None
