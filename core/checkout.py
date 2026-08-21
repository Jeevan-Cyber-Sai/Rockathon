"""Automated Universal One-Click Checkout Orchestrator.

Simulates and executes multi-vendor fulfillment across Amazon, Flipkart,
Croma, Reliance Digital, and other marketplaces. Generates vendor tracking
numbers, coordinates automated split shipments, calculates savings & taxes,
and records durable orders into the local ledger.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from core import store


def _generate_tracking_number(source: str) -> str:
    prefix = {
        "Amazon": "AMZN-IN",
        "Flipkart": "FKRT-EXP",
        "Croma": "CRMA-DLV",
        "Reliance Digital": "RDIG-EXP",
        "Vijay Sales": "VJYS-TRK",
        "Tata Cliq": "TATA-LOG",
    }.get(source, f"{source[:4].upper()}-TRK")
    rand_num = random.randint(1000000, 9999999)
    return f"{prefix}-{rand_num}"


def _generate_invoice_number() -> str:
    year = datetime.now(timezone.utc).year
    rand_id = uuid.uuid4().hex[:8].upper()
    return f"SHPX-{year}-{rand_id}"


def execute_checkout(
    run_id: str,
    customer_name: str,
    customer_email: str,
    customer_phone: str,
    shipping_address: str,
    pincode: str,
    payment_method: str = "upi",
    custom_lines: list[dict] | None = None,
) -> dict[str, Any]:
    """Processes universal checkout for a decision run and places the order."""
    run = store.get_run(run_id)
    if run is None:
        raise KeyError(f"Run {run_id} not found")

    decision = run.get("decisions", [])[-1] if run.get("decisions") else None
    chosen = decision.get("chosen") if decision else None

    # Lines to purchase: from chosen allocation or custom lines passed
    lines = custom_lines or (chosen.get("lines") if chosen else [])
    if not lines:
        raise ValueError("No items found to purchase for this run.")

    total_base_cost = sum(line.get("unit_price", 0) * line.get("qty", 1) for line in lines)
    # Simulated automated coupon discovery savings (3% - 7%)
    discount_amount = int(total_base_cost * 0.05) if total_base_cost > 2000 else 0
    final_amount = total_base_cost - discount_amount

    # Build multi-vendor split shipments
    split_shipments = []
    now = datetime.now(timezone.utc)

    for line in lines:
        source = line.get("source", "Marketplace")
        delivery_days = line.get("delivery_days", 3) or 3
        eta_date = now + timedelta(days=delivery_days)
        tracking_num = _generate_tracking_number(source)

        shipment = {
            "shipment_id": f"SHP-{uuid.uuid4().hex[:6].upper()}",
            "vendor": source,
            "product_id": line.get("product_id"),
            "title": line.get("title", "Product Item"),
            "qty": line.get("qty", 1),
            "unit_price": line.get("unit_price", 0),
            "total_price": line.get("unit_price", 0) * line.get("qty", 1),
            "tracking_number": tracking_num,
            "carrier": f"{source} Logistics / Express Courier",
            "delivery_eta": eta_date.strftime("%b %d, %Y"),
            "status": "order_placed",
            "timeline": [
                {
                    "time": now.strftime("%I:%M %p"),
                    "status": "Order Placed & Verified",
                    "note": f"Fulfillment agent locked price on {source}",
                },
                {
                    "time": (now + timedelta(hours=2)).strftime("%I:%M %p"),
                    "status": "Merchant Packing",
                    "note": "Package is being prepared for dispatch",
                },
            ],
        }
        split_shipments.append(shipment)

    invoice_no = _generate_invoice_number()

    # Store in database
    order_id = store.create_order(
        run_id=run_id,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_phone=customer_phone,
        shipping_address=shipping_address,
        pincode=pincode,
        payment_method=payment_method,
        total_amount=final_amount,
        discount_amount=discount_amount,
        split_shipments=split_shipments,
        invoice_number=invoice_no,
        status="confirmed",
    )

    return {
        "order_id": order_id,
        "run_id": run_id,
        "invoice_number": invoice_no,
        "customer_name": customer_name,
        "customer_email": customer_email,
        "shipping_address": shipping_address,
        "pincode": pincode,
        "payment_method": payment_method,
        "total_amount": final_amount,
        "discount_amount": discount_amount,
        "split_shipments": split_shipments,
        "status": "confirmed",
        "created_at": now.isoformat(),
    }
