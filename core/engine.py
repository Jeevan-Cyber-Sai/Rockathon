"""The decision engine: ParsedBrief + fetched/deduped products -> an allocation.

Filter -> score -> best single vendor -> split across up to 3 -> compare ->
bend elastic rules one at a time if nothing fits. Every call to decide()
writes its result through core/store.py so the run is on the record.

Rule enforcement policy: FILTER (step 1) only drops offers that fail a RIGID
rule - elastic rules stay in force too for the primary single/split solve
(elasticity is a last-resort escape hatch, not something to ignore up front).
Only NOTHING_FITS deliberately relaxes one elastic rule at a time, and only
after a full-strength solve has already failed.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Literal

from ortools.sat.python import cp_model

from . import store
from .dedupe import ProductGroup
from .models import Listing
from .parser import ParsedBrief, Rule

log = logging.getLogger("engine")

MAX_VENDORS = 3
SPEC_FIELDS = ("ram_gb", "storage_gb")           # rule op ">=" against the offer's spec
PRICE_FIELD = "price_per_unit"                    # rule op "<=" against offer.price
DELIVERY_FIELD = "delivery_days"                  # rule op "<=" against offer.delivery_days
QUANTITY_FIELD = "quantity"                       # aggregate, not a per-offer filter
OFFER_RULE_FIELDS = SPEC_FIELDS + (PRICE_FIELD, DELIVERY_FIELD)

# Rule names never treated as a generic, title-matched requirement: the four
# offer-level fields above (each has its own typed check), quantity (an
# aggregate, not a per-offer property), and product_type (drives the search
# query in api/pipeline.py - matching it against the title too would risk
# rejecting real results over phrasing, e.g. "insulated bottle" vs "water
# bottle").
_NON_GENERIC_RULE_FIELDS = OFFER_RULE_FIELDS + (QUANTITY_FIELD, "product_type")


@dataclass
class Candidate:
    """One purchasable line: a specific offer, with its product's spec attached."""

    offer: Listing
    group: ProductGroup
    # Names of soft (elastic) generic requirements this offer's title did not
    # confirm - filled in by filter_offers, read by score_candidates to lower
    # confidence the same way a missing rating/delivery_days already does.
    unknown_soft: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ram_gb(self) -> int | None:
        return self.offer.ram_gb if self.offer.ram_gb is not None else self.group.ram_gb

    @property
    def storage_gb(self) -> int | None:
        return self.offer.storage_gb if self.offer.storage_gb is not None else self.group.storage_gb

    def label(self) -> str:
        return f"{self.offer.source}:{self.offer.product_id} ({self.group.canonical_title[:40]})"


def _offer_value(candidate: Candidate, field: str):
    if field == "ram_gb":
        return candidate.ram_gb
    if field == "storage_gb":
        return candidate.storage_gb
    if field == PRICE_FIELD:
        return candidate.offer.price
    if field == DELIVERY_FIELD:
        return candidate.offer.delivery_days
    raise ValueError(f"not an offer-level field: {field}")


def _compare(op: str, actual, target) -> bool:
    if op in (">=", "~"):   # "~"/approx specs are treated as a minimum, same as ">="
        return actual >= target
    if op == "<=":
        return actual <= target
    if op == "==":
        return actual == target
    if op == ">":
        return actual > target
    if op == "<":
        return actual < target
    raise ValueError(f"unknown op: {op}")


def _normalise_phrase(s: str) -> str:
    """Hyphens/underscores collapse to spaces and case folds, so "leak-proof"
    in a rule matches "leak proof" in a title (and vice versa) - the same
    kind of surface variation real sellers write, not a semantic difference."""
    return re.sub(r"[-_]+", " ", s.strip().lower())


# A match immediately preceded by one of these is the opposite of a match:
# "Non WiFi Printer" literally contains "wifi", and a plain substring test
# scored it as satisfying a WiFi requirement.
_NEGATORS = ("non", "no", "not", "without", "excluding")


def _requirement_phrase_found(offer: Listing, rule: Rule) -> bool:
    """Generic, category-agnostic requirement check: is this rule's value (a
    short phrase - "stainless steel", "leak proof", "bluetooth") asserted by
    the offer's title? There is no per-attribute schema or unit parsing here
    by design - a phrase not found means UNKNOWN, not "confirmed absent": a
    seller's title can easily omit an attribute the product genuinely has.
    Caller decides what unknown means for rigid vs. elastic.

    A negated occurrence doesn't count, so a title has to actually claim the
    attribute rather than merely mention the word.
    """
    if not str(rule.value).strip():
        return False

    # A separator inside one concept is written every which way ("Wi-Fi",
    # "Wi Fi", "WiFi"), so each side is compared both with the separator as a
    # space and with it removed entirely. Splitting only one way meant a
    # "WiFi" requirement missed a "Wi-Fi" title.
    for haystack in _separator_variants(offer.title):
        for needle in _separator_variants(str(rule.value)):
            if _found_unnegated(haystack, needle):
                return True
    return False


def _separator_variants(s: str) -> tuple[str, str]:
    """The same text with hyphens/underscores read as a space, and with them
    closed up. Spaces themselves are never removed - the negator test relies
    on word boundaries, and collapsing "non wifi" to "nonwifi" would hide the
    "non" from it.
    """
    low = s.strip().lower()
    return (re.sub(r"[-_]+", " ", low), re.sub(r"[-_]+", "", low))


def _found_unnegated(haystack: str, needle: str) -> bool:
    """`needle` appears in `haystack` at least once without a negator in
    front of it."""
    if not needle:
        return False
    start = haystack.find(needle)
    while start != -1:
        preceding = haystack[:start].split()
        if not preceding or preceding[-1] not in _NEGATORS:
            return True  # one un-negated mention is enough
        start = haystack.find(needle, start + 1)
    return False


# A denylist, not a classifier: common words/phrases that mark a listing as
# an accessory or spare part FOR a product rather than the product itself
# (a printer's spare roller, a power bank's silicone case, both of which
# otherwise pass every stated rule and can out-price the real thing). Kept
# deliberately small and literal - this is a cheap sanity filter, not
# attribute extraction.
_ACCESSORY_SIGNAL_WORDS = (
    "case", "cover", "pouch", "sleeve", "strap",
    "relay", "roller", "gear",
    "spare part", "replacement part",
)

# "Compatible with X" is NOT an accessory signal on its own - plenty of real
# products list what they work with ("10000mAh Power Bank | Compatible with
# iPhone"). It only indicates an accessory when the thing being sold is not
# itself the product, which the position test below distinguishes.
_COMPATIBILITY_PHRASES = ("compatible with", "compatible for", "for use in")


def _looks_like_accessory(offer: Listing, product_type: Rule | None) -> bool:
    """True if the title reads as an accessory/part FOR the product rather
    than the product itself.

    Two independent signals:
    1. A part/accessory noun anywhere in the title (case, roller, gear, ...).
    2. A compatibility phrase that the product noun does NOT precede. Real
       products name themselves first and list compatibility afterwards
       ("... Power Bank | ... Compatible with ..."); accessories lead with
       the part and name the host product later, if at all ("Ink Bottle
       Compatible for Epson Printers"). Comparing the two positions
       separates them without needing a per-category schema.
    """
    title = _normalise_phrase(offer.title)
    if any(word in title for word in _ACCESSORY_SIGNAL_WORDS):
        return True

    pt = _normalise_phrase(str(product_type.value)) if product_type is not None else ""
    if pt and f"for {pt}" in title:
        return True

    compat_positions = [title.find(p) for p in _COMPATIBILITY_PHRASES if p in title]
    if compat_positions:
        # The head noun, not the whole phrase: a title says "power bank",
        # rarely the full "20000mAh usb-c power bank" the brief described.
        head_noun = pt.split()[-1] if pt else ""
        noun_at = title.find(head_noun) if head_noun else -1
        if noun_at == -1 or noun_at > min(compat_positions):
            return True
    return False


def generic_requirements(rules: dict[str, Rule]) -> dict[str, Rule]:
    """Everything in `rules` that isn't one of the typed offer fields, the
    aggregate quantity field, or product_type - i.e. whatever the parser
    extracted for a non-laptop brief (material, capacity, connectivity, ...).
    Reused by both the filter step and score_candidates so both agree on
    exactly which rules are "generic"."""
    return {name: rule for name, rule in rules.items() if name not in _NON_GENERIC_RULE_FIELDS}


def _offer_meets(candidate: Candidate, rules: dict[str, Rule], rigid_only: bool,
                  overrides: dict[str, float] | None = None) -> bool:
    """True if this offer satisfies every applicable rule (optionally with one
    rule's threshold swapped for a relaxed value, for the bending search)."""
    overrides = overrides or {}

    if _looks_like_accessory(candidate.offer, rules.get("product_type")):
        return False

    for name in OFFER_RULE_FIELDS:
        rule = rules.get(name)
        if rule is None:
            continue
        if rigid_only and rule.elastic:
            continue
        actual = _offer_value(candidate, name)
        if actual is None:
            # A rigid rule we cannot verify is treated as failed, not as a free
            # pass - "unknown" is not the same as "compliant" for a hard cap.
            return False
        target = overrides.get(name, rule.value)
        if not _compare(rule.op, actual, target):
            return False

    for name, rule in generic_requirements(rules).items():
        if rigid_only and rule.elastic:
            continue
        if not _requirement_phrase_found(candidate.offer, rule) and not rule.elastic:
            # Same "unknown is not compliant" policy as a rigid offer-level
            # field above - just via a title search instead of a typed value.
            return False
    return True


def filter_offers(rules: dict[str, Rule], products: list[ProductGroup], *,
                   rigid_only: bool = True,
                   overrides: dict[str, float] | None = None) -> list[Candidate]:
    """Step 1: drop offers failing a rule. rigid_only=True is the FILTER step
    proper; rigid_only=False (used by the solvers) also enforces elastic rules
    at full strength, since bending only happens in NOTHING_FITS."""
    out = []
    for group in products:
        for offer in group.offers:
            candidate = Candidate(offer=offer, group=group)
            if not _offer_meets(candidate, rules, rigid_only=rigid_only, overrides=overrides):
                continue
            candidate.unknown_soft = tuple(
                name for name, rule in generic_requirements(rules).items()
                if rule.elastic and not _requirement_phrase_found(offer, rule)
            )
            out.append(candidate)
    return out


# --- step 2: score --------------------------------------------------------

# Price dominates (it's the number on the invoice), delivery next, rating a
# minor tie-breaker - a well-rated laptop that's 10 days late is still late.
_WEIGHTS = {"price": 0.55, "delivery": 0.30, "rating": 0.15}
_DEFAULT_RATING = 3.5  # a neutral "unknown" prior, not the worst possible score


@dataclass
class ScoredCandidate:
    candidate: Candidate
    score: float             # 0-1, higher is better
    confidence: float        # 0-1, lowered by missing data - never by a bad score
    missing: tuple[str, ...] = ()

    @property
    def offer(self) -> Listing:
        return self.candidate.offer


def _minmax(values: list[float], value: float, higher_is_better: bool) -> float:
    lo, hi = min(values), max(values)
    if hi == lo:
        return 1.0  # every candidate identical on this axis - don't penalize any of them
    frac = (value - lo) / (hi - lo)
    return frac if higher_is_better else 1 - frac


def score_candidates(candidates: list[Candidate]) -> list[ScoredCandidate]:
    """Rank survivors on price, delivery, rating. A missing delivery/rating is
    imputed with a neutral value (never treated as the worst possible outcome)
    and instead lowers that candidate's confidence, so a ranking built on
    guesswork is visibly less certain than one built on real data."""
    if not candidates:
        return []

    prices = [c.offer.price for c in candidates]
    known_delivery = [c.offer.delivery_days for c in candidates if c.offer.delivery_days is not None]
    known_rating = [c.offer.rating for c in candidates if c.offer.rating is not None]
    neutral_delivery = sum(known_delivery) / len(known_delivery) if known_delivery else 7.0
    neutral_rating = sum(known_rating) / len(known_rating) if known_rating else _DEFAULT_RATING

    all_delivery = [d if d is not None else neutral_delivery for d in
                     (c.offer.delivery_days for c in candidates)]
    all_rating = [r if r is not None else neutral_rating for r in
                  (c.offer.rating for c in candidates)]

    scored = []
    for c, delivery_val, rating_val in zip(candidates, all_delivery, all_rating):
        missing = []
        confidence = 1.0
        if c.offer.delivery_days is None:
            missing.append("delivery_days")
            confidence -= 0.15
        if c.offer.rating is None:
            missing.append("rating")
            confidence -= 0.10
        for name in c.unknown_soft:
            # A soft (elastic) generic requirement whose phrase the title
            # never confirmed - same treatment as a missing rating: not
            # disqualifying, just less certain. Same per-item weight as
            # rating, since it's the same kind of "seller didn't say" gap.
            missing.append(name)
            confidence -= 0.10

        price_score = _minmax(prices, c.offer.price, higher_is_better=False)
        delivery_score = _minmax(all_delivery, delivery_val, higher_is_better=False)
        rating_score = _minmax(all_rating, rating_val, higher_is_better=True)
        overall = (_WEIGHTS["price"] * price_score + _WEIGHTS["delivery"] * delivery_score
                   + _WEIGHTS["rating"] * rating_score)

        scored.append(ScoredCandidate(candidate=c, score=round(overall, 4),
                                       confidence=round(max(confidence, 0.5), 2),
                                       missing=tuple(missing)))

    return sorted(scored, key=lambda s: s.score, reverse=True)


# --- step 3: best single vendor -------------------------------------------


def _quantity_target(rules: dict[str, Rule]) -> int:
    rule = rules.get(QUANTITY_FIELD)
    return int(rule.value) if rule is not None else 1


def _allocation_line(offer: Listing, qty: int) -> dict:
    """One purchasable line, as persisted in the decision record.

    Carries `url` so the decision can actually be acted on - a recommendation
    you can't click through to is a dead end - plus the rating/image the UI
    needs to present it without re-joining against the listings snapshot.
    """
    return {
        "source": offer.source,
        "product_id": offer.product_id,
        "title": offer.title,
        "url": offer.url,
        "image_url": offer.image_url,
        "unit_price": offer.price,
        "qty": qty,
        "delivery_days": offer.delivery_days,
        "rating": offer.rating,
        "rating_count": offer.rating_count,
        # True when the retailer listed no unit count, so the quantity is
        # assumed rather than vendor-confirmed. Surfaced so a purchase order
        # built from this never silently overstates what was verified.
        "quantity_assumed": offer.stock is None,
    }


def _why_cheapest(offer: Listing, considered: int, next_cheapest: int | None) -> str:
    """Plain-English reason this offer won, in terms of the pool it beat.

    Deliberately only claims what the engine actually compared: price among
    offers that already satisfy every rule. It does not imply the product is
    better in any way the engine never measured.
    """
    if considered <= 1:
        return f"The only {offer.source} offer that met every rule."
    if next_cheapest is not None and next_cheapest > offer.price:
        saving = next_cheapest - offer.price
        return (f"Cheapest of {considered} offers that met every rule - "
                f"{_rupees(saving)} below the next cheapest "
                f"({_rupees(next_cheapest)}).")
    return f"Cheapest of {considered} offers that met every rule."


@dataclass
class SingleVendorResult:
    candidate: Candidate
    quantity: int
    total_cost: int
    latest_delivery: int | None

    # How many other offers cleared every rule, and what the next cheapest of
    # them cost - the evidence behind "why this one". Defaulted so an
    # allocation built without them still works.
    considered: int = 0
    next_cheapest: int | None = None

    def to_allocation(self) -> dict:
        return {
            "mode": "single_vendor",
            "lines": [_allocation_line(self.candidate.offer, self.quantity)],
            "total_cost": self.total_cost,
            "latest_delivery": self.latest_delivery,
            "considered": self.considered,
            "why_this_pick": _why_cheapest(
                self.candidate.offer, self.considered, self.next_cheapest
            ),
        }


def _units_available(offer: Listing, qty_target: int) -> int:
    """How many units this offer can supply.

    `stock is None` does NOT mean "we don't know if it's purchasable" - the
    adapters only ever set it from an explicit signal: 0 when the listing
    says out-of-stock/unavailable, N when it says "only N left", and None
    for an ordinary in-stock listing that simply doesn't publish a count.
    Treating None as unbuyable therefore excluded virtually every real
    listing and made almost every brief come back infeasible.

    So None means "in stock, count not stated" and is assumed able to cover
    the target. 0 still means out of stock and supplies nothing.
    """
    if offer.stock is None:
        return qty_target
    return offer.stock


def best_single_vendor(rules: dict[str, Rule], candidates: list[Candidate]) -> SingleVendorResult | None:
    """Cheapest offer that meets every rule (rigid and elastic - see module
    docstring) and can cover the quantity. An explicitly out-of-stock offer
    is excluded; one that just doesn't publish a count is not - see
    _units_available."""
    qty = _quantity_target(rules)
    eligible = [c for c in candidates if _units_available(c.offer, qty) >= qty]
    if not eligible:
        return None
    by_price = sorted(eligible, key=lambda c: c.offer.price)
    best = by_price[0]
    runner_up_price = by_price[1].offer.price if len(by_price) > 1 else None
    return SingleVendorResult(candidate=best, quantity=qty, total_cost=best.offer.price * qty,
                               considered=len(eligible), next_cheapest=runner_up_price,
                               latest_delivery=best.offer.delivery_days)


# --- step 4: split orders (OR-Tools CP-SAT) --------------------------------


@dataclass
class SplitResult:
    lines: list[tuple[Candidate, int]]   # (candidate, qty) for each vendor used
    total_cost: int
    latest_delivery: int | None

    considered: int = 0

    def to_allocation(self) -> dict:
        cheapest_unit = min((c.offer.price for c, _ in self.lines), default=None)
        return {
            "mode": "split_order",
            "lines": [_allocation_line(c.offer, qty) for c, qty in self.lines],
            "total_cost": self.total_cost,
            "latest_delivery": self.latest_delivery,
            "considered": self.considered,
            "why_this_pick": (
                f"No single vendor had {sum(q for _, q in self.lines)} units in "
                f"confirmed stock, so the order is split across "
                f"{len(self.lines)} vendors - the cheapest combination that "
                f"covers the full quantity"
                + (f", from {_rupees(cheapest_unit)} per unit." if cheapest_unit
                   else ".")
            ),
        }


def split_order(rules: dict[str, Rule], candidates: list[Candidate],
                 max_vendors: int = MAX_VENDORS) -> SplitResult | None:
    """Cheapest way to cover the target quantity across up to max_vendors
    offers, respecting each one's own stock. Same availability policy as
    best_single_vendor (see _units_available): an explicitly out-of-stock
    offer supplies nothing, one that simply doesn't publish a count is
    assumed able to cover the order.

    Total-budget and latest-delivery requirements are not separate solver
    constraints - every candidate already individually satisfies the price
    cap and the delivery deadline (filter_offers enforced that), so any
    combination of them satisfies both automatically. The solver's only real
    job is: cover the quantity, respect stock, use at most max_vendors,
    minimize spend.
    """
    qty_target = _quantity_target(rules)
    pool = [c for c in candidates if _units_available(c.offer, qty_target) > 0]
    if not pool:
        return None

    model = cp_model.CpModel()
    qty_vars, use_vars = [], []
    for i, c in enumerate(pool):
        cap = min(_units_available(c.offer, qty_target), qty_target)
        q = model.NewIntVar(0, cap, f"qty_{i}")
        u = model.NewBoolVar(f"use_{i}")
        model.Add(q <= cap * u)
        model.Add(q >= 1).OnlyEnforceIf(u)
        model.Add(q == 0).OnlyEnforceIf(u.Not())
        qty_vars.append(q)
        use_vars.append(u)

    quantity_rule = rules.get(QUANTITY_FIELD)
    if quantity_rule is not None and quantity_rule.op == "==":
        model.Add(sum(qty_vars) == qty_target)
    else:
        # cost minimization naturally avoids buying more than needed
        model.Add(sum(qty_vars) >= qty_target)
    model.Add(sum(use_vars) <= max_vendors)

    total_cost = model.NewIntVar(0, 10**9, "total_cost")
    model.Add(total_cost == sum(c.offer.price * q for c, q in zip(pool, qty_vars)))
    model.Minimize(total_cost)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    lines = [(c, solver.Value(q)) for c, q in zip(pool, qty_vars) if solver.Value(q) > 0]
    delivered = [c.offer.delivery_days for c, _ in lines if c.offer.delivery_days is not None]
    return SplitResult(lines=lines, total_cost=solver.Value(total_cost),
                        latest_delivery=max(delivered) if delivered else None,
                        considered=len(pool))


# --- step 5: compare --------------------------------------------------------

# Splitting only wins if it saves a real amount - not a token ₹1 that isn't
# worth the extra vendor coordination. Whichever savings figure is larger.
SPLIT_SAVINGS_THRESHOLD_RUPEES = 500
SPLIT_SAVINGS_THRESHOLD_FRACTION = 0.01


def _rupees(n: int) -> str:
    return f"Rs {n:,}"


@dataclass
class Comparison:
    mode: Literal["single_vendor", "split_order"]
    allocation: dict
    total_cost: int
    latest_delivery: int | None
    runner_up: dict | None
    why_rejected: str | None
    counterfactual: str | None


def compare_allocations(single: SingleVendorResult | None,
                         split: SplitResult | None) -> Comparison | None:
    """Pick single vs. split, whichever is genuinely better; keep the loser
    as runner_up with a plain-English reason it lost."""
    # A split that resolves to one vendor isn't really a split - it's the same
    # shape of purchase as "single", so there is nothing distinct to compare.
    if split is not None and len(split.lines) <= 1:
        split = None

    if single is None and split is None:
        return None
    if single is None:
        return Comparison("split_order", split.to_allocation(), split.total_cost,
                           split.latest_delivery, None, None, None)
    if split is None:
        return Comparison("single_vendor", single.to_allocation(), single.total_cost,
                           single.latest_delivery, None, None, None)

    threshold = max(SPLIT_SAVINGS_THRESHOLD_RUPEES,
                     round(SPLIT_SAVINGS_THRESHOLD_FRACTION * single.total_cost))
    savings = single.total_cost - split.total_cost   # positive means split is cheaper
    vendor_count = len(split.lines)

    if savings > threshold:
        why = (f"Buying everything from {single.candidate.offer.source} alone "
               f"({single.candidate.offer.title[:50]}) would have cost "
               f"{_rupees(single.total_cost)} - {_rupees(savings)} more than splitting "
               f"across {vendor_count} vendors.")
        counterfactual = (f"If splitting had saved {_rupees(threshold)} or less, the "
                          f"single-vendor purchase would have been chosen instead, to "
                          f"avoid the coordination overhead of {vendor_count} vendors.")
        return Comparison("split_order", split.to_allocation(), split.total_cost,
                           split.latest_delivery, single.to_allocation(), why, counterfactual)

    if savings > 0:
        why = (f"Splitting across {vendor_count} vendors would have saved only "
               f"{_rupees(savings)} over the single-vendor purchase - not enough to "
               f"justify the added coordination for a {threshold:,}-rupee threshold.")
        counterfactual = (f"If the split option had saved more than {_rupees(threshold)}, "
                          f"it would have been chosen instead.")
    else:
        why = (f"Splitting across {vendor_count} vendors would have cost "
               f"{_rupees(-savings)} more than buying from a single vendor, with no "
               f"benefit to offset the added coordination.")
        counterfactual = (f"If splitting had been at least {_rupees(threshold)} cheaper "
                          f"than the single-vendor option, it would have been chosen instead.")
    return Comparison("single_vendor", single.to_allocation(), single.total_cost,
                       single.latest_delivery, split.to_allocation(), why, counterfactual)


def _best_matching_tier(candidates: list[Candidate]) -> list[Candidate]:
    """The candidates that confirm the most of the brief's soft attributes.

    Soft (elastic) requirements never reject an offer, so without this the
    choice came down to price alone and a cheaper listing that contradicts
    the brief would beat one that matches it - a "WiFi printer" brief could
    be answered with a printer whose own title says "Non WiFi". Selecting
    the best-matching tier first makes a stated attribute count for
    something, while price still decides within the tier.
    """
    if not candidates:
        return candidates
    fewest_unmatched = min(len(c.unknown_soft) for c in candidates)
    return [c for c in candidates if len(c.unknown_soft) == fewest_unmatched]


def _solve_pool(rules: dict[str, Rule], candidates: list[Candidate],
                 overrides: dict[str, float] | None) -> Comparison | None:
    single = best_single_vendor(rules, candidates)
    if overrides and QUANTITY_FIELD in overrides:
        single = _resize_single(single, int(overrides[QUANTITY_FIELD])) if single else None
    split = split_order(rules, candidates)
    return compare_allocations(single, split)


def solve(rules: dict[str, Rule], products: list[ProductGroup],
          overrides: dict[str, float] | None = None) -> Comparison | None:
    """Full-strength solve (filter -> single -> split -> compare) for one set
    of rule thresholds, optionally with one rule's value swapped out."""
    candidates = filter_offers(rules, products, rigid_only=False, overrides=overrides)

    # Try the offers that best match the stated soft attributes first. If
    # that narrower pool can't cover the order (too few units, too few
    # vendors), fall back to the full pool rather than failing outright -
    # a soft requirement must never be the reason nothing can be bought.
    preferred = _best_matching_tier(candidates)
    if len(preferred) < len(candidates):
        result = _solve_pool(rules, preferred, overrides)
        if result is not None:
            return result
    return _solve_pool(rules, candidates, overrides)


def _resize_single(result: SingleVendorResult, qty: int) -> SingleVendorResult | None:
    if _units_available(result.candidate.offer, qty) < qty:
        return None
    return SingleVendorResult(candidate=result.candidate, quantity=qty,
                               total_cost=result.candidate.offer.price * qty,
                               latest_delivery=result.candidate.offer.delivery_days)


# --- step 6: nothing fits - bend one elastic rule at a time ----------------


@dataclass
class WayOut:
    rule: str
    original_value: float
    bent_value: float
    comparison: Comparison

    def describe(self) -> str:
        direction = "raised to" if self.bent_value > self.original_value else "lowered to"
        return (f"{self.rule} {direction} {self.bent_value} (was {self.original_value}) "
                f"-> {self.comparison.mode}, {_rupees(self.comparison.total_cost)}")


def _loosened_values(rule_name: str, rule: Rule, all_offers: list[Listing]) -> list[float]:
    """Candidate relaxed thresholds for one rule, ordered smallest bend first,
    drawn from values that actually exist in the offer pool - there is no
    point testing a cap no real listing would even use."""
    if rule_name == QUANTITY_FIELD:
        return list(range(int(rule.value) - 1, 0, -1))

    values = {_offer_value_from_listing(o, rule_name) for o in all_offers}
    values.discard(None)

    if rule.op in ("<=",):  # price / delivery: loosen upward
        return sorted(v for v in values if v > rule.value)
    if rule.op in (">=", "~"):  # specs: loosen downward
        return sorted((v for v in values if v < rule.value), reverse=True)
    return []


def _offer_value_from_listing(offer: Listing, field: str):
    if field == "ram_gb":
        return offer.ram_gb
    if field == "storage_gb":
        return offer.storage_gb
    if field == PRICE_FIELD:
        return offer.price
    if field == DELIVERY_FIELD:
        return offer.delivery_days
    return None


def find_ways_out(rules: dict[str, Rule], products: list[ProductGroup],
                   max_results: int = 3) -> list[WayOut]:
    """Try bending each elastic rule, one at a time, to the smallest relaxation
    that makes some allocation feasible. Returns up to max_results, cheapest
    first. A rule that can't be bent into feasibility at all contributes
    nothing - this is a search for real rescues, not a guarantee of one."""
    all_offers = [o for g in products for o in g.offers]
    ways_out: list[WayOut] = []

    for name, rule in rules.items():
        if not rule.elastic or name not in OFFER_RULE_FIELDS + (QUANTITY_FIELD,):
            continue
        for candidate_value in _loosened_values(name, rule, all_offers):
            result = solve(rules, products, overrides={name: candidate_value})
            if result is not None:
                ways_out.append(WayOut(rule=name, original_value=rule.value,
                                        bent_value=candidate_value, comparison=result))
                break  # smallest bend that works - stop searching this rule

    ways_out.sort(key=lambda w: w.comparison.total_cost)
    return ways_out[:max_results]


# --- entry point -------------------------------------------------------


@dataclass
class Decision:
    run_id: str
    decision_id: str
    mode: Literal["single_vendor", "split_order", "bent", "infeasible"]
    chosen: dict
    total_cost: int | None
    latest_delivery: int | None
    runner_up: dict | None
    why_rejected: str | None
    counterfactual: str | None
    ways_out: list[dict] = field(default_factory=list)
    needs_confirmation: list[str] = field(default_factory=list)


def decide(parsed_brief: ParsedBrief, products: list[ProductGroup]) -> Decision:
    """ParsedBrief + fetched/deduped products -> an allocation, persisted.

    filter -> score -> best single vendor -> split up to 3 vendors -> compare
    -> if nothing fits, bend one elastic rule at a time and report the 3
    cheapest ways out. Every call writes its result through core/store.py.
    """
    rules = parsed_brief.all_rules()

    run_id = store.start_run(parsed_brief.raw_text)
    store.save_parsed_rules(run_id, {k: v.model_dump() for k, v in rules.items()})
    all_offers = [o for g in products for o in g.offers]
    store.save_listings(run_id, [o.model_dump(mode="json") for o in all_offers])

    result = solve(rules, products)

    if result is not None:
        decision_id = store.save_decision(
            run_id, chosen=result.allocation, runner_up=result.runner_up,
            why_rejected=result.why_rejected, counterfactual=result.counterfactual,
            total_cost=result.total_cost, latest_delivery=result.latest_delivery,
        )
        store.complete_run(run_id)
        return Decision(run_id, decision_id, result.mode, result.allocation,
                         result.total_cost, result.latest_delivery, result.runner_up,
                         result.why_rejected, result.counterfactual,
                         needs_confirmation=parsed_brief.needs_confirmation)

    # Nothing fits at full strength - try bending one elastic rule at a time.
    ways_out = find_ways_out(rules, products)

    if not ways_out:
        chosen = {
            "mode": "infeasible",
            "reason": "No allocation exists even after trying every elastic rule "
                      "one at a time. A single relaxation was not enough - this "
                      "brief needs more than one rule to move, or the market "
                      "genuinely does not have what was asked for.",
            "rules": {k: v.model_dump() for k, v in rules.items()},
        }
        why_rejected = ("Every rigid rule was enforced and no single elastic rule, "
                        "bent on its own, produced a feasible purchase.")
        decision_id = store.save_decision(run_id, chosen=chosen, why_rejected=why_rejected)
        store.fail_run(run_id)
        return Decision(run_id, decision_id, "infeasible", chosen, None, None, None,
                         why_rejected, None, needs_confirmation=parsed_brief.needs_confirmation)

    best = ways_out[0]
    runner_up_way = ways_out[1] if len(ways_out) > 1 else None
    chosen = {**best.comparison.allocation, "bent_rule": best.rule,
              "bent_from": best.original_value, "bent_to": best.bent_value}

    why_rejected = (
        f"The brief's rules as stated had no valid allocation - every offer meeting "
        f"the hard requirements failed on {best.rule} (needed {_relation(rules[best.rule])} "
        f"{best.original_value}). Relaxing {best.rule} to {best.bent_value} was the "
        f"smallest change that made a purchase possible."
    )
    counterfactual = None
    runner_up_payload = None
    if runner_up_way is not None:
        delta = runner_up_way.comparison.total_cost - best.comparison.total_cost
        runner_up_payload = {**runner_up_way.comparison.allocation, "bent_rule": runner_up_way.rule,
                              "bent_from": runner_up_way.original_value,
                              "bent_to": runner_up_way.bent_value}
        counterfactual = (f"Bending {runner_up_way.rule} to {runner_up_way.bent_value} instead "
                          f"would also have worked, but cost {_rupees(delta)} more "
                          f"({_rupees(runner_up_way.comparison.total_cost)} total).")

    decision_id = store.save_decision(
        run_id, chosen=chosen, runner_up=runner_up_payload, why_rejected=why_rejected,
        counterfactual=counterfactual, total_cost=best.comparison.total_cost,
        latest_delivery=best.comparison.latest_delivery,
    )
    store.complete_run(run_id)
    return Decision(run_id, decision_id, "bent", chosen, best.comparison.total_cost,
                     best.comparison.latest_delivery, runner_up_payload, why_rejected,
                     counterfactual, ways_out=[w.describe() for w in ways_out],
                     needs_confirmation=parsed_brief.needs_confirmation)


def _relation(rule: Rule) -> str:
    return {"<=": "at most", ">=": "at least", "==": "exactly", "~": "around",
            ">": "more than", "<": "less than"}.get(rule.op, rule.op)
