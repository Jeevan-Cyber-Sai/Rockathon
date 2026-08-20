"""Generates 30 fake but realistic laptop listings for offline development.

    python scripts/make_fixtures.py

Deliberately messy in the ways real feeds are messy: the same model priced
differently on two sources, missing delivery, missing ratings, and RAM/storage
written inconsistently across titles - so normalise.py and dedupe.py have
something real to chew on even with no API key.
"""

from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.models import Listing  # noqa: E402

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "fixtures" / "laptops.json"

random.seed(42)  # reproducible fixtures - a re-run should not silently change the demo

SOURCES = ["amazon", "flipkart", "reliance_digital"]

# (brand, model, processor, price_hint) - real Indian retail models, Rs 35k-55k.
MODELS = [
    ("Acer", "Aspire 3 A325-45", "Intel Core i3-1215U", 38990),
    ("Acer", "Aspire Lite AL15-51", "Intel Core i5-12450H", 46990),
    ("ASUS", "Vivobook 15 X1504VA", "Intel Core i5-1335U", 47990),
    ("ASUS", "Vivobook Go 15 E1504FA", "AMD Ryzen 5 7520U", 39990),
    ("HP", "15s-fq5111TU", "Intel Core i3-1215U", 36990),
    ("HP", "Laptop 15-fc0106AU", "AMD Ryzen 5 7430U", 44990),
    ("Lenovo", "IdeaPad Slim 3", "Intel Core i5-12450H", 45990),
    ("Lenovo", "V15 G4", "AMD Ryzen 5 7520U", 41990),
    ("Dell", "Vostro 3520", "Intel Core i3-1215U", 39990),
    ("Dell", "Inspiron 3520", "Intel Core i5-1235U", 49990),
    ("MSI", "Modern 14 C13M", "Intel Core i3-1315U", 42990),
    ("realme", "Book Prime", "Intel Core i5-11320H", 43990),
    ("Infinix", "Y1 Plus Neo", "Intel Celeron N4500", 35990),
    ("Samsung", "Galaxy Book4", "Intel Core i5-120U", 51990),
    ("Acer", "Extensa 15 EX215", "Intel Core i3-1215U", 37990),
]

# Same spec, written differently by different retailers/sellers.
RAM_STYLES = ["{n} GB", "{n}GB", "{n}gb RAM", "{n} GB DDR4", "{n}GB LPDDR5"]
STORAGE_STYLES = [
    "{n}GB SSD", "{n} GB SSD", "{n}GB M.2 SSD", "{n}GB NVMe SSD",
    "{tb}TB HDD" if False else "{n}GB PCIe SSD",
]
DELIVERY_STYLES = ["2-4 days", "3-5 business days", "Tomorrow", "5-7 days", None, None]
TITLE_TEMPLATES = [
    "{brand} {model}, {cpu}, {ram_txt}, {storage_txt}, 15.6\" FHD, Windows 11",
    "{brand} {model} ({cpu}/{ram_txt}/{storage_txt}) Thin & Light Laptop",
    "{brand} {model} - {cpu} - {ram_txt} - {storage_txt} - Win 11 Home",
    "{brand} {model}, {cpu}, {ram_txt}/{storage_txt}, FHD Display",
]


def make_listing(idx: int, brand, model, cpu, base_price, source, ram, storage,
                  price_jitter, with_rating, with_delivery, template_i):
    ram_style = RAM_STYLES[idx % len(RAM_STYLES)]
    storage_style = ["{n}GB SSD", "{n} GB SSD", "{n}GB M.2 SSD", "{n}GB NVMe SSD"][idx % 4]
    title = TITLE_TEMPLATES[template_i].format(
        brand=brand, model=model, cpu=cpu,
        ram_txt=ram_style.format(n=ram),
        storage_txt=storage_style.format(n=storage),
    )
    price = base_price + price_jitter
    kwargs = dict(
        source=source,
        product_id=f"{source[:3].upper()}{idx:05d}",
        title=title,
        url=f"https://{source}.example.in/dp/{source[:3].upper()}{idx:05d}",
        price=price,
        ram_gb=ram,
        storage_gb=storage,
        storage_type="SSD",
        processor=cpu,
        fetched_at=datetime.now(timezone.utc),
    )
    if with_rating:
        kwargs["rating"] = round(random.uniform(3.2, 4.7), 1)
        kwargs["rating_count"] = random.randint(5, 2000)
    if with_delivery:
        # Store the resolved day count directly - normalise.py is exercised
        # separately against raw strings; fixtures store clean Listings.
        kwargs["delivery_days"] = random.choice([1, 2, 3, 4, 5, 7])
    kwargs["stock"] = random.choice([None, None, 0, 3, 12])
    return Listing(**kwargs)


def main() -> None:
    listings: list[Listing] = []
    idx = 0

    # Every model gets one listing; some get a second on a different source at
    # a different price, so dedupe has genuine cross-retailer pairs to merge.
    for i, (brand, model, cpu, base_price) in enumerate(MODELS):
        ram = random.choice([8, 16])
        storage = 512

        idx += 1
        listings.append(make_listing(
            idx, brand, model, cpu, base_price, SOURCES[i % len(SOURCES)],
            ram, storage, price_jitter=0,
            with_rating=(i % 4 != 0),          # some unrated
            with_delivery=(i % 3 != 0),        # some missing delivery
            template_i=idx % len(TITLE_TEMPLATES),
        ))

        if i % 2 == 0:  # every other model also listed on a second retailer
            other_source = SOURCES[(i + 1) % len(SOURCES)]
            idx += 1
            listings.append(make_listing(
                idx, brand, model, cpu, base_price, other_source,
                ram, storage, price_jitter=random.choice([-1500, -800, 900, 2200]),
                with_rating=(i % 5 != 0),
                with_delivery=(i % 4 != 0),
                template_i=idx % len(TITLE_TEMPLATES),
            ))

    # Top up to exactly 30 with more cross-retailer duplicates of early models.
    while len(listings) < 30:
        i = len(listings) % len(MODELS)
        brand, model, cpu, base_price = MODELS[i]
        idx += 1
        listings.append(make_listing(
            idx, brand, model, cpu, base_price, random.choice(SOURCES),
            random.choice([8, 16]), 512,
            price_jitter=random.choice([-2000, -1000, 500, 1500, 3000]),
            with_rating=True, with_delivery=True,
            template_i=idx % len(TITLE_TEMPLATES),
        ))

    listings = listings[:30]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps([json.loads(l.model_dump_json()) for l in listings], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    unrated = sum(1 for l in listings if l.rating is None)
    no_delivery = sum(1 for l in listings if l.delivery_days is None)
    print(f"wrote {len(listings)} listings -> {OUT_PATH}")
    print(f"  unrated: {unrated}  |  delivery unknown: {no_delivery}  |  "
          f"price range: Rs {min(l.price for l in listings):,}-{max(l.price for l in listings):,}")


if __name__ == "__main__":
    main()
