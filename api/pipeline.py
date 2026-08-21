"""Orchestrates one run: parse -> fetch -> dedupe -> filter -> score -> decide.

Deliberately does NOT call engine.decide() - that function creates its own
run_id internally, which would fight with the API's need to hand a run_id
back to the caller before the pipeline has even started. Instead this module
composes engine.py's already-public step functions against a run_id the API
layer created up front, and publishes a WebSocket event after each stage.

Every persisted fact goes through core/store.py exactly as engine.decide()
would use it - store.py, engine.py and the adapters are untouched.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable

from core import store
from core.adapter import build_all
from core.dedupe import group_listings
from core.engine import (
    DELIVERY_FIELD,
    PRICE_FIELD,
    SPEC_FIELDS,
    best_single_vendor,
    compare_allocations,
    filter_offers,
    find_ways_out,
    generic_requirements,
    price_context,
    score_candidates,
    solve,
)
from core.models import Listing
from core.parser import ParsedBrief, Rule, parse_brief

log = logging.getLogger("api.pipeline")

FIXTURES_PATH = Path(__file__).resolve().parent.parent / "data" / "fixtures" / "laptops.json"

Broadcast = Callable[[str, dict | None], None]


# Attributes worth putting IN the search box, in the order a person would
# type them. Brand first: it's by far the strongest relevance signal Amazon
# has, and a brand-less query for "charger" returns unbranded filler that
# then fails the brand rule at the filter step - the search and the filter
# end up asking for different things.
_QUERY_LEADING_ATTRS = ("brand", "make", "manufacturer")
# Cap on how many other stated attributes get appended. Amazon's relevance
# degrades fast on long queries - past a few terms it starts returning
# loosely-related filler or nothing at all, so the extra specificity costs
# more than it buys.
_MAX_EXTRA_QUERY_ATTRS = 2


def _query_terms_from_requirements(rules: dict[str, Rule]) -> tuple[list[str], list[str]]:
    """(leading, extra) short text attributes to fold into the search query.

    Only the generic text requirements the parser extracted - never the
    numeric/typed fields, which have their own handling below.
    """
    leading, extra = [], []
    for name, rule in generic_requirements(rules).items():
        value = str(rule.value).strip()
        # Long values are prose, not search terms; they'd blow up the query.
        if not value or len(value.split()) > 3:
            continue
        (leading if name in _QUERY_LEADING_ATTRS else extra).append(value)
    return leading, extra


def _build_query(rules: dict[str, Rule]) -> str:
    """Build the retailer search string from the brief's own words.

    product_type names the thing; brand (when stated) leads, since that's
    what actually steers Amazon's relevance; a couple of other stated
    attributes follow; ram/storage keep their explicit spec formatting.
    "laptop" is only a fallback for the rare case product_type is absent
    (e.g. the regex parser fallback, which doesn't always extract it).
    """
    product_type = rules.get("product_type")
    leading, extra = _query_terms_from_requirements(rules)

    parts = list(leading)
    parts.append(str(product_type.value) if product_type is not None else "laptop")
    parts.extend(extra[:_MAX_EXTRA_QUERY_ATTRS])

    if "ram_gb" in rules:
        parts.append(f"{int(rules['ram_gb'].value)}GB RAM")
    if "storage_gb" in rules:
        parts.append(f"{int(rules['storage_gb'].value)}GB SSD")

    # Drop any term wholly contained in another ("samsung" once product_type
    # is already "samsung charger"): repeats add no signal and long queries
    # actively hurt relevance. Longest-first so the MORE specific term is the
    # one kept, then the original ordering is restored.
    kept: list[str] = []
    for part in sorted(parts, key=lambda p: -len(p)):
        if any(part.lower() in k.lower() for k in kept):
            continue
        kept.append(part)

    ordered: list[str] = []
    for part in parts:
        if part in kept and part not in ordered:
            ordered.append(part)
    return " ".join(ordered)


def _load_fixtures(rules: dict[str, Rule]) -> list[Listing]:
    if not FIXTURES_PATH.exists():
        return []
    raw = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    listings = [Listing(**row) for row in raw]
    ram, storage = rules.get("ram_gb"), rules.get("storage_gb")
    if ram is not None:
        listings = [l for l in listings if l.ram_gb == int(ram.value)] or listings
    if storage is not None:
        listings = [l for l in listings if l.storage_gb == int(storage.value)] or listings
    return listings


def fetch_listings(rules: dict[str, Rule], *, lat: float | None = None,
                    lon: float | None = None, pincode: str | None = None,
                    platforms: list[str] | None = None) -> list[Listing]:
    """Live adapters if any are usable, fixtures otherwise - same fallback
    scripts/fetch.py uses, reimplemented here since scripts/ isn't a package.

    lat/lon/pincode/platforms are QuickCommerce-only (location-gated search).
    Every adapter is called the same way; Amazon's adapter accepts and
    ignores them (see its **kwargs), so this stays a single uniform loop
    rather than adapter-specific branches here.
    """
    query = _build_query(rules)
    adapters = build_all()
    if not adapters:
        log.warning("no usable adapters - falling back to fixtures")
        return _load_fixtures(rules)
    listings: list[Listing] = []
    for adapter in adapters:
        # Every adapter's contract says "never raise" (core/adapter.py), but
        # this loop no longer just trusts that - one adapter misbehaving
        # must never cost the results already collected from another. This
        # is what actually makes "Amazon still works if QuickCommerce fails"
        # true rather than assumed.
        try:
            listings.extend(adapter.search(query, lat=lat, lon=lon, pincode=pincode, platforms=platforms))
        except Exception as exc:
            log.warning("adapter %s.search() raised despite its contract - skipping it, "
                       "other adapters are unaffected: %s", adapter.name, exc)
    return listings


def _rules_from_stored(parsed_rules: dict) -> dict[str, Rule]:
    return {name: Rule(**value) for name, value in parsed_rules.items()}


def _products_from_snapshot(snapshot_rows: list[dict]):
    listings = [Listing(**row) for snap in snapshot_rows for row in snap["listings"]]
    return group_listings(listings)


def _listing_card(l: Listing) -> dict:
    """The shape a product card needs - a subset of the full Listing, same
    field names, safe to send over the wire on every "fetched" broadcast."""
    return {
        "source": l.source, "product_id": l.product_id, "title": l.title, "url": l.url,
        "image_url": l.image_url, "price": l.price, "ram_gb": l.ram_gb,
        "storage_gb": l.storage_gb, "storage_type": l.storage_type,
        "delivery_days": l.delivery_days, "rating": l.rating,
        "rating_count": l.rating_count, "stock": l.stock,
        # QuickCommerce-only fields - None for every existing (Amazon) listing.
        "platform": l.platform, "brand": l.brand, "mrp": l.mrp, "pack_size": l.pack_size,
    }


_OP_CMP = {
    ">=": lambda a, t: a >= t, "~": lambda a, t: a >= t, "<=": lambda a, t: a <= t,
    "==": lambda a, t: a == t, ">": lambda a, t: a > t, "<": lambda a, t: a < t,
}
# Which rule to blame when more than one fails - price and delivery are what
# a buyer actually notices first; spec gaps are usually smaller misses.
_REASON_FIELDS = (PRICE_FIELD, DELIVERY_FIELD) + SPEC_FIELDS
_REASON_TEXT = {
    PRICE_FIELD: "over budget", DELIVERY_FIELD: "delivery too slow",
    "ram_gb": "not enough RAM", "storage_gb": "not enough storage",
}


def _offer_field(offer: Listing, group, field: str):
    if field in ("ram_gb", "storage_gb"):
        own = getattr(offer, field)
        return own if own is not None else getattr(group, field)
    return offer.price if field == PRICE_FIELD else offer.delivery_days


def _rejection_reason(rules: dict[str, Rule], offer: Listing, group) -> str:
    """Best-effort explanation only - which candidates actually survive comes
    from engine.filter_offers()/score_candidates(), never from this. If this
    disagrees with that on some edge case, only the displayed reason text is
    wrong, never who's shown as filtered out."""
    for field in _REASON_FIELDS:
        rule = rules.get(field)
        if rule is None:
            continue
        actual = _offer_field(offer, group, field)
        if actual is None or not _OP_CMP[rule.op](actual, rule.value):
            return _REASON_TEXT[field]
    return "didn't meet the brief"  # rules.get(...) missing entirely - rare, but not impossible


def _solve_and_persist(run_id: str, rules: dict[str, Rule], products, broadcast: Broadcast) -> None:
    """The shared tail end of both a fresh run and a resumed one: run the
    solver, and either save a completed decision or open an approval."""
    comparison = solve(rules, products)

    if comparison is not None:
        ctx = price_context(rules, products, comparison.allocation)
        if ctx is not None:
            comparison.allocation["price_context"] = ctx
        store.save_decision(
            run_id, chosen=comparison.allocation, runner_up=comparison.runner_up,
            why_rejected=comparison.why_rejected, counterfactual=comparison.counterfactual,
            total_cost=comparison.total_cost, latest_delivery=comparison.latest_delivery,
        )
        store.complete_run(run_id)
        broadcast("decided", {"mode": comparison.mode, "total_cost": comparison.total_cost})
        broadcast("completed", {"total_cost": comparison.total_cost,
                                 "latest_delivery": comparison.latest_delivery})
        return

    ways_out = find_ways_out(rules, products)

    if not ways_out:
        why_rejected = ("Every rigid rule was enforced and no single elastic rule, "
                        "bent on its own, produced a feasible purchase.")
        chosen = {"mode": "infeasible", "reason": why_rejected,
                  "rules": {k: v.model_dump() for k, v in rules.items()}}
        store.save_decision(run_id, chosen=chosen, why_rejected=why_rejected)
        store.fail_run(run_id)
        broadcast("failed", {"reason": why_rejected})
        return

    options = [
        {"key": f"option_{i + 1}", "rule": w.rule, "original_value": w.original_value,
         "bent_value": w.bent_value, "mode": w.comparison.mode,
         "total_cost": w.comparison.total_cost, "description": w.describe()}
        for i, w in enumerate(ways_out)
    ]
    approval_id = store.request_approval(
        run_id,
        question="No allocation meets every rule as stated. Choose which rule to relax:",
        options=options,
    )
    broadcast("awaiting_approval", {"approval_id": approval_id, "options": options})


def run_pipeline(run_id: str, brief_text: str, broadcast: Broadcast, *,
                  lat: float | None = None, lon: float | None = None,
                  pincode: str | None = None, platforms: list[str] | None = None) -> None:
    """Synchronous - the caller runs this in a worker thread.

    lat/lon/pincode/platforms are optional and QuickCommerce-only - a call
    that omits them behaves exactly as before this integration existed.
    """
    try:
        brief: ParsedBrief = parse_brief(brief_text)
        rules = brief.all_rules()
        store.save_parsed_rules(run_id, {k: v.model_dump() for k, v in rules.items()})
        broadcast("parsed", {"rules": {k: v.model_dump() for k, v in rules.items()},
                              "needs_confirmation": brief.needs_confirmation})

        listings = fetch_listings(rules, lat=lat, lon=lon, pincode=pincode, platforms=platforms)
        store.save_listings(run_id, [l.model_dump(mode="json") for l in listings])
        broadcast("fetched", {"count": len(listings), "listings": [_listing_card(l) for l in listings]})

        products = group_listings(listings)
        candidates = filter_offers(rules, products, rigid_only=False)
        survived = {(c.offer.source, c.offer.product_id) for c in candidates}
        rejected = [
            {"source": o.source, "product_id": o.product_id,
             "reason": _rejection_reason(rules, o, g)}
            for g in products for o in g.offers
            if (o.source, o.product_id) not in survived
        ]
        broadcast("filtered", {"count": len(candidates), "rejected": rejected})

        scored = score_candidates(candidates)
        broadcast("scored", {
            "count": len(scored),
            "order": [{"source": sc.offer.source, "product_id": sc.offer.product_id,
                       "score": sc.score} for sc in scored],
        })

        _solve_and_persist(run_id, rules, products, broadcast)

    except Exception as exc:
        log.exception("pipeline failed for run %s", run_id)
        try:
            store.fail_run(run_id)
        except Exception:
            pass
        broadcast("failed", {"reason": str(exc)})


def resume_pipeline(run_id: str, chosen_key: str, broadcast: Broadcast) -> None:
    """Synchronous - the caller runs this in a worker thread."""
    try:
        row = store.get_run(run_id)
        if row is None:
            raise ValueError(f"unknown run {run_id}")

        pending = next((a for a in row["approvals"] if a["chosen_option"] is None), None)
        if pending is None:
            raise ValueError(f"run {run_id} has no pending approval")

        options = pending["options"]
        match = next((o for o in options if o["key"] == chosen_key), None)
        if match is None:
            raise ValueError(f"unknown option {chosen_key!r} - choices were "
                             f"{[o['key'] for o in options]}")

        store.record_approval(pending["id"], chosen_key)

        rules = _rules_from_stored(row["parsed_rules"])
        products = _products_from_snapshot(row["listings"])

        comparison = solve(rules, products, overrides={match["rule"]: match["bent_value"]})
        if comparison is None:
            # The option was feasible when offered; a live catalog could in
            # principle have changed by the time it's approved.
            why_rejected = (f"The previously-offered relaxation of {match['rule']} to "
                            f"{match['bent_value']} is no longer feasible.")
            store.save_decision(run_id, chosen={"mode": "infeasible", "reason": why_rejected},
                                why_rejected=why_rejected)
            store.fail_run(run_id)
            broadcast("failed", {"reason": why_rejected})
            return

        chosen = {**comparison.allocation, "bent_rule": match["rule"],
                  "bent_from": match["original_value"], "bent_to": match["bent_value"]}
        ctx = price_context(rules, products, chosen)
        if ctx is not None:
            chosen["price_context"] = ctx
        store.save_decision(
            run_id, chosen=chosen, runner_up=comparison.runner_up,
            why_rejected=comparison.why_rejected, counterfactual=comparison.counterfactual,
            total_cost=comparison.total_cost, latest_delivery=comparison.latest_delivery,
        )
        store.complete_run(run_id)
        broadcast("decided", {"mode": comparison.mode, "total_cost": comparison.total_cost})
        broadcast("completed", {"total_cost": comparison.total_cost,
                                 "latest_delivery": comparison.latest_delivery})

    except Exception as exc:
        log.exception("resume failed for run %s", run_id)
        try:
            store.fail_run(run_id)
        except Exception:
            pass
        broadcast("failed", {"reason": str(exc)})
