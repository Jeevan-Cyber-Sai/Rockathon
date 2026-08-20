"""Grouping listings that are the same laptop, across and within retailers.

Comparing a laptop against itself is the failure mode that matters most here -
a fake price gap between "the same thing twice" looks like a real deal to the
decision engine. Every merge decision is logged so it can be inspected, and
every non-merge above a look-twice threshold is logged too.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from rapidfuzz import fuzz

from .models import Listing
from .normalise import normalise_title

log = logging.getLogger("dedupe")

# Two titles this close, with matching specs, are treated as one product.
TITLE_MATCH_THRESHOLD = 78
# Below this there is no point logging the comparison at all.
LOG_THRESHOLD = 60


@dataclass
class ProductGroup:
    """One canonical product, with every retailer's offer attached.

    This is what the decision engine consumes - it should never see a bare
    Listing, only groups, so it can never compare a product against itself.
    """

    canonical_title: str
    offers: list[Listing] = field(default_factory=list)

    @property
    def ram_gb(self) -> int | None:
        return _first_non_none(o.ram_gb for o in self.offers)

    @property
    def storage_gb(self) -> int | None:
        return _first_non_none(o.storage_gb for o in self.offers)

    @property
    def storage_type(self) -> str | None:
        return _first_non_none(o.storage_type for o in self.offers)

    @property
    def processor(self) -> str | None:
        return _first_non_none(o.processor for o in self.offers)

    @property
    def sources(self) -> list[str]:
        return sorted({o.source for o in self.offers})

    @property
    def cheapest(self) -> Listing:
        return min(self.offers, key=lambda o: o.price)

    @property
    def fastest(self) -> Listing | None:
        with_delivery = [o for o in self.offers if o.delivery_days is not None]
        return min(with_delivery, key=lambda o: o.delivery_days) if with_delivery else None

    def __len__(self) -> int:
        return len(self.offers)


def _first_non_none(values):
    return next((v for v in values if v is not None), None)


def _specs_compatible(a: Listing, b: Listing) -> bool:
    """Specs must agree where both are known. Unknown-vs-known is not a conflict.

    A title-similarity score alone is not enough: "Celeron N4500" and "Pentium
    N6000" barely change the wording around them and can score above threshold
    on title text alone. Two different processors is two different laptops,
    no matter how close the RAM and storage look.
    """
    if a.ram_gb is not None and b.ram_gb is not None and a.ram_gb != b.ram_gb:
        return False
    if a.storage_gb is not None and b.storage_gb is not None and a.storage_gb != b.storage_gb:
        return False
    if (a.storage_type is not None and b.storage_type is not None
            and a.storage_type != b.storage_type):
        return False
    if a.processor is not None and b.processor is not None:
        pa, pb = a.processor.lower(), b.processor.lower()
        # A generic "Intel Core i5" is compatible with a specific "i5-12450H"
        # from the other listing; two named, differing chips are not.
        if pa not in pb and pb not in pa:
            return False
    return True


def _title_score(norm_a: str, norm_b: str) -> float:
    """token_set_ratio ignores word order and repeats - "HP 15 i5" vs "i5 HP 15
    laptop" should score high; plain ratio would punish the reordering."""
    if not norm_a or not norm_b:
        return 0.0
    return fuzz.token_set_ratio(norm_a, norm_b)


def group_listings(listings: list[Listing]) -> list[ProductGroup]:
    """Greedy clustering: each listing joins the first group it fits, else
    starts a new one. O(n * groups); fine at the scale a single query returns.
    """
    groups: list[ProductGroup] = []
    norms = [normalise_title(l.title) for l in listings]

    for listing, norm in zip(listings, norms):
        placed = False
        for group in groups:
            group_norm = normalise_title(group.canonical_title)
            score = _title_score(norm, group_norm)
            specs_ok = _specs_compatible(listing, group.offers[0])

            if score >= LOG_THRESHOLD:
                log.info(
                    "compare %s:%s vs group %r -> title=%.0f specs_ok=%s",
                    listing.source, listing.product_id, group.canonical_title[:40],
                    score, specs_ok,
                )

            if score >= TITLE_MATCH_THRESHOLD and specs_ok:
                group.offers.append(listing)
                log.info(
                    "MERGE  %s:%s (%r) -> group %r  [title=%.0f, ram=%s, storage=%s%s]",
                    listing.source, listing.product_id, listing.title[:50],
                    group.canonical_title[:50], score, listing.ram_gb,
                    listing.storage_gb, listing.storage_type or "",
                )
                placed = True
                break

        if not placed:
            groups.append(ProductGroup(canonical_title=listing.title, offers=[listing]))
            log.info("NEW GROUP  %s:%s (%r)", listing.source, listing.product_id, listing.title[:50])

    return groups


def dedupe_stats(raw_count: int, groups: list[ProductGroup]) -> dict:
    multi = [g for g in groups if len(g) > 1]
    return {
        "raw": raw_count,
        "groups": len(groups),
        "merged_groups": len(multi),
        "merged_listings": sum(len(g) for g in multi),
        "sources_per_group_max": max((len(g.sources) for g in groups), default=0),
    }
