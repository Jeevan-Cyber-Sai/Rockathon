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


@dataclass
class Candidate:
    """One purchasable line: a specific offer, with its product's spec attached."""

    offer: Listing
    group: ProductGroup

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


def _offer_meets(candidate: Candidate, rules: dict[str, Rule], rigid_only: bool,
                  overrides: dict[str, float] | None = None) -> bool:
    """True if this offer satisfies every applicable rule (optionally with one
    rule's threshold swapped for a relaxed value, for the bending search)."""
    overrides = overrides or {}
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
            if _offer_meets(candidate, rules, rigid_only=rigid_only, overrides=overrides):
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


@dataclass
class SingleVendorResult:
    candidate: Candidate
    quantity: int
    total_cost: int
    latest_delivery: int | None

    def to_allocation(self) -> dict:
        return {
            "mode": "single_vendor",
            "lines": [{
                "source": self.candidate.offer.source,
                "product_id": self.candidate.offer.product_id,
                "title": self.candidate.offer.title,
                "unit_price": self.candidate.offer.price,
                "qty": self.quantity,
                "delivery_days": self.candidate.offer.delivery_days,
            }],
            "total_cost": self.total_cost,
            "latest_delivery": self.latest_delivery,
        }


def best_single_vendor(rules: dict[str, Rule], candidates: list[Candidate]) -> SingleVendorResult | None:
    """Cheapest offer with known, sufficient stock that meets every rule
    (rigid and elastic - see module docstring). Unknown stock is excluded: a
    "best single vendor" recommendation should be ready to execute, and we
    cannot promise fulfilment on a quantity we cannot confirm is in stock."""
    qty = _quantity_target(rules)
    eligible = [c for c in candidates if c.offer.stock is not None and c.offer.stock >= qty]
    if not eligible:
        return None
    best = min(eligible, key=lambda c: c.offer.price)
    return SingleVendorResult(candidate=best, quantity=qty, total_cost=best.offer.price * qty,
                               latest_delivery=best.offer.delivery_days)


# --- step 4: split orders (OR-Tools CP-SAT) --------------------------------


@dataclass
class SplitResult:
    lines: list[tuple[Candidate, int]]   # (candidate, qty) for each vendor used
    total_cost: int
    latest_delivery: int | None

    def to_allocation(self) -> dict:
        return {
            "mode": "split_order",
            "lines": [{
                "source": c.offer.source,
                "product_id": c.offer.product_id,
                "title": c.offer.title,
                "unit_price": c.offer.price,
                "qty": qty,
                "delivery_days": c.offer.delivery_days,
            } for c, qty in self.lines],
            "total_cost": self.total_cost,
            "latest_delivery": self.latest_delivery,
        }


def split_order(rules: dict[str, Rule], candidates: list[Candidate],
                 max_vendors: int = MAX_VENDORS) -> SplitResult | None:
    """Cheapest way to cover the target quantity across up to max_vendors
    offers, respecting each one's own stock. Same known-stock-only policy as
    best_single_vendor: an offer we cannot confirm has stock cannot be
    promised a specific quantity in a concrete purchase order.

    Total-budget and latest-delivery requirements are not separate solver
    constraints - every candidate already individually satisfies the price
    cap and the delivery deadline (filter_offers enforced that), so any
    combination of them satisfies both automatically. The solver's only real
    job is: cover the quantity, respect stock, use at most max_vendors,
    minimize spend.
    """
    qty_target = _quantity_target(rules)
    pool = [c for c in candidates if c.offer.stock is not None and c.offer.stock > 0]
    if not pool:
        return None

    model = cp_model.CpModel()
    qty_vars, use_vars = [], []
    for i, c in enumerate(pool):
        cap = min(c.offer.stock, qty_target)
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
                        latest_delivery=max(delivered) if delivered else None)


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


def solve(rules: dict[str, Rule], products: list[ProductGroup],
          overrides: dict[str, float] | None = None) -> Comparison | None:
    """Full-strength solve (filter -> single -> split -> compare) for one set
    of rule thresholds, optionally with one rule's value swapped out."""
    candidates = filter_offers(rules, products, rigid_only=False, overrides=overrides)
    single = best_single_vendor(rules, candidates)
    if overrides and QUANTITY_FIELD in overrides:
        single = _resize_single(single, int(overrides[QUANTITY_FIELD])) if single else None
    split = split_order(rules, candidates)
    return compare_allocations(single, split)


def _resize_single(result: SingleVendorResult, qty: int) -> SingleVendorResult | None:
    if result.candidate.offer.stock is None or result.candidate.offer.stock < qty:
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
