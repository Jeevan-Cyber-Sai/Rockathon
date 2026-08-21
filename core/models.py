"""The Listing model - the single shape every adapter must produce.

House rule: unknown is None. Never 0, never "", never "N/A". A zero that means
"we didn't find out" will quietly win a price comparison or a delivery race, so
the validators below convert those sentinels to None at construction time.

The one exception is `stock`, where 0 is real information: out of stock.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

log = logging.getLogger("models")

StorageType = Literal["SSD", "HDD"]

# "N/A", "-", "unknown" and friends turn up in real feeds as if they were values.
_NULLISH = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "not specified"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Listing(BaseModel):
    """One offer, from one retailer, at one moment in time.

    Frozen: a listing is a fact about the past. Build a changed one with
    `listing.model_copy(update={...})` rather than mutating in place.
    """

    model_config = ConfigDict(frozen=True, str_strip_whitespace=True, extra="forbid")

    source: str = Field(min_length=1)          # PROVIDER, e.g. "amazon", "quickcommerce"
    product_id: str = Field(min_length=1)      # the retailer's own id
    title: str = Field(min_length=1)           # raw listing title, unmodified
    url: str = Field(min_length=1)
    price: int = Field(gt=0)                   # WHOLE RUPEES, no paise
    image_url: str | None = None

    # MARKETPLACE, distinct from the provider in `source` - e.g. source=
    # "quickcommerce" (the API that answered the call), platform="Flipkart"
    # (who you'd actually be buying from). None for single-marketplace
    # providers like Amazon/Rainforest, where source already names the one
    # marketplace it can ever return.
    platform: str | None = None
    brand: str | None = None
    mrp: int | None = Field(default=None, gt=0)   # list price before any offer discount
    pack_size: str | None = None                   # e.g. "500 ml", "1 kg" - quick-commerce pack/quantity label

    ram_gb: int | None = Field(default=None, gt=0)
    storage_gb: int | None = Field(default=None, gt=0)
    storage_type: StorageType | None = None
    processor: str | None = None

    delivery_days: int | None = Field(default=None, ge=1)   # None = unknown
    rating: float | None = Field(default=None, gt=0, le=5)  # None = unrated
    rating_count: int | None = Field(default=None, ge=0)
    stock: int | None = Field(default=None, ge=0)           # 0 = out of stock

    fetched_at: datetime = Field(default_factory=utcnow)

    # --- text fields: blank and placeholder strings are not values -----------

    @field_validator("processor", "image_url", "platform", "brand", "pack_size", mode="before")
    @classmethod
    def _nullish_to_none(cls, v):
        if isinstance(v, str) and v.strip().lower() in _NULLISH:
            return None
        return v

    @field_validator("storage_type", mode="before")
    @classmethod
    def _canonical_storage_type(cls, v):
        """Accept ssd / M.2 SSD / nvme / hdd; anything else is not a storage type."""
        if v is None or not isinstance(v, str):
            return v
        t = v.strip().lower()
        if t in _NULLISH:
            return None
        if "ssd" in t or "nvme" in t or "emmc" in t:
            return "SSD"
        if "hdd" in t or "hard disk" in t or "hard drive" in t:
            return "HDD"
        log.warning("unrecognised storage_type %r -> None", v)
        return None

    # --- numbers: strip currency noise, reject fake zeros --------------------

    @field_validator("price", mode="before")
    @classmethod
    def _rupees(cls, v):
        """'Rs 45,999.00' / '₹45,999' / 45999.0 -> 45999. Paise are rounded off."""
        if isinstance(v, str):
            cleaned = re.sub(r"[^\d.]", "", v)
            if not cleaned:
                raise ValueError(f"no price in {v!r}")
            v = float(cleaned)
        if isinstance(v, float):
            v = round(v)
        return v

    @field_validator("mrp", mode="before")
    @classmethod
    def _mrp_rupees(cls, v):
        """Same cleanup as price, but mrp is optional - an unparseable or
        blank value is unknown (None), not a validation failure."""
        if v is None:
            return None
        if isinstance(v, str):
            cleaned = re.sub(r"[^\d.]", "", v)
            if not cleaned:
                return None
            v = float(cleaned)
        if isinstance(v, float):
            v = round(v)
        return v

    @field_validator("delivery_days", mode="before")
    @classmethod
    def _delivery(cls, v):
        """0 means same day, not unknown - keep it as 1 so it never reads as 'free'."""
        if v is None:
            return None
        if isinstance(v, str):
            if v.strip().lower() in _NULLISH:
                return None
            v = float(v)
        if isinstance(v, float):
            v = round(v)
        if v == 0:
            return 1
        if v < 0:
            log.warning("negative delivery_days %r -> None", v)
            return None
        return v

    @field_validator("rating", mode="before")
    @classmethod
    def _rating(cls, v):
        """0.0 from a feed means 'nobody rated it', which is None, not terrible."""
        if v is None:
            return None
        if isinstance(v, str):
            if v.strip().lower() in _NULLISH:
                return None
            m = re.search(r"\d+(?:\.\d+)?", v)
            if m is None:
                return None
            v = float(m.group())
        if v == 0:
            return None
        if not 0 < v <= 5:
            # Out of range is a bad feed, not a reason to drop the whole listing.
            log.warning("rating %r out of range -> None", v)
            return None
        return v

    @field_validator("ram_gb", "storage_gb", "rating_count", "stock", mode="before")
    @classmethod
    def _blank_number(cls, v):
        if isinstance(v, str):
            if v.strip().lower() in _NULLISH:
                return None
            v = re.sub(r"[^\d]", "", v) or None
        return v

    @field_validator("ram_gb", "storage_gb", mode="before")
    @classmethod
    def _zero_spec_is_unknown(cls, v):
        """0 GB of RAM is not a laptop; it is a missing field."""
        if v in (0, "0", 0.0):
            log.warning("zero spec value -> None")
            return None
        return v

    # --- time ---------------------------------------------------------------

    @field_validator("fetched_at", mode="before")
    @classmethod
    def _utc(cls, v):
        """Naive input is assumed UTC; aware input is converted to it."""
        if isinstance(v, str):
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if isinstance(v, datetime):
            if v.tzinfo is None:
                return v.replace(tzinfo=timezone.utc)
            return v.astimezone(timezone.utc)
        return v

    @model_validator(mode="after")
    def _consistency(self):
        # A review count without a score is noise the decision engine can't use.
        if self.rating is None and self.rating_count:
            log.debug("%s/%s: rating_count without rating", self.source, self.product_id)
        # Storage type with no size (or the reverse) is fine; both stay as found.
        return self

    def __str__(self) -> str:
        return f"{self.source}:{self.product_id} Rs {self.price:,} {self.title[:40]!r}"
