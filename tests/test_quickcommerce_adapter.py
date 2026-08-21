"""Focused tests for the QuickCommerce adapter and its normalization layer.

Everything here is mocked at core.cache.fetch_json (the one choke point all
HTTP in this codebase goes through) or requests.get directly - no real
network call is made, and no credit is ever spent running this file.

Run with:  python -m pytest tests/test_quickcommerce_adapter.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.adapter import AdapterUnavailable
from core.models import Listing
from adapters import quickcommerce as qc


FLIPKART_RESULT = {
    "id": "FK123", "name": "Test Wireless Mouse", "brand": "Logitech",
    "available": True, "images": ["https://img.example/mouse.jpg"],
    "mrp": 1499, "offer_price": 999, "quantity": "1 unit",
    "deeplink": "https://flipkart.com/p/FK123",
    "rating": 4.3, "rating_count": 210, "inventory": 12, "platform": "Flipkart",
}


def _adapter(monkeypatch, key="test-key-123"):
    if key is None:
        monkeypatch.delenv("QUICKCOMMERCE_API_KEY", raising=False)
    else:
        monkeypatch.setenv("QUICKCOMMERCE_API_KEY", key)
    return qc.QuickCommerceAdapter()


# --- 1. missing API key ------------------------------------------------------

def test_missing_api_key_raises_adapter_unavailable(monkeypatch):
    monkeypatch.delenv("QUICKCOMMERCE_API_KEY", raising=False)
    with pytest.raises(AdapterUnavailable):
        qc.QuickCommerceAdapter()


# --- 2. invalid API key / 401 ------------------------------------------------

def test_invalid_api_key_401_returns_empty_not_raise(monkeypatch):
    adapter = _adapter(monkeypatch)
    resp = MagicMock(status_code=401)
    err = requests.HTTPError(response=resp)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", side_effect=err):
        result = adapter.search("mouse", lat=12.9, lon=77.6, platforms=["Flipkart"])
    assert result == []


# --- 3/4/5. valid searches on three different platforms ---------------------

@pytest.mark.parametrize("platform", ["Flipkart", "Myntra", "Nykaa"])
def test_valid_search_normalizes_correctly(monkeypatch, platform):
    adapter = _adapter(monkeypatch)
    raw = {**FLIPKART_RESULT, "platform": platform}
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", return_value=({"results": [raw]}, False)):
        result = adapter.search("wireless mouse", lat=12.97, lon=77.59, platforms=[platform])

    assert len(result) == 1
    listing = result[0]
    assert isinstance(listing, Listing)
    assert listing.source == "quickcommerce"          # provider
    assert listing.platform == platform                # marketplace, distinct from provider
    assert listing.product_id == "FK123"
    assert listing.title == "Test Wireless Mouse"
    assert listing.brand == "Logitech"
    assert listing.price == 999          # offer_price
    assert listing.mrp == 1499
    assert listing.url == "https://flipkart.com/p/FK123"
    assert listing.image_url == "https://img.example/mouse.jpg"
    assert listing.rating == 4.3
    assert listing.rating_count == 210
    assert listing.stock == 12           # inventory count
    assert listing.pack_size == "1 unit"


# --- 6. unsupported platform --------------------------------------------------

def test_unsupported_platform_is_dropped_not_requested(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json") as mock_fetch:
        result = adapter.search("mouse", lat=12.9, lon=77.6, platforms=["TotallyFakeMart"])
    mock_fetch.assert_not_called()  # never spends a credit on an unsupported platform
    assert result == []


# --- 7. missing lat/lon --------------------------------------------------------

def test_missing_lat_lon_skips_without_calling_api(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch("core.cache.fetch_json") as mock_fetch:
        result = adapter.search("mouse", platforms=["Flipkart"])  # no lat/lon
    mock_fetch.assert_not_called()
    assert result == []


def test_no_platforms_requested_skips_without_calling_api(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch("core.cache.fetch_json") as mock_fetch:
        result = adapter.search("mouse", lat=12.9, lon=77.6)  # no platforms
    mock_fetch.assert_not_called()
    assert result == []


# --- 8. pincode-required platform ---------------------------------------------

def test_pincode_required_platform_skipped_without_pincode(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json") as mock_fetch:
        result = adapter.search("milk", lat=12.9, lon=77.6, platforms=["DMart"])  # no pincode
    mock_fetch.assert_not_called()
    assert result == []


def test_pincode_required_platform_proceeds_with_pincode(monkeypatch):
    adapter = _adapter(monkeypatch)
    raw = {**FLIPKART_RESULT, "id": "DM1", "platform": "DMart"}
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", return_value=({"results": [raw]}, False)) as mock_fetch:
        result = adapter.search("milk", lat=12.9, lon=77.6, pincode="560001", platforms=["DMart"])
    mock_fetch.assert_called_once()
    assert len(result) == 1
    assert result[0].platform == "DMart"


# --- 9. timeout / connection failure -----------------------------------------

def test_timeout_returns_empty_not_raise(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", side_effect=requests.Timeout("timed out")):
        result = adapter.search("mouse", lat=12.9, lon=77.6, platforms=["Flipkart"])
    assert result == []  # never raises


def test_connection_error_returns_empty_not_raise(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", side_effect=requests.ConnectionError("refused")):
        result = adapter.search("mouse", lat=12.9, lon=77.6, platforms=["Flipkart"])
    assert result == []


# --- 10/11. graceful degradation between providers ----------------------------

def test_quickcommerce_failure_does_not_affect_amazon(monkeypatch):
    """fetch_listings() calls every discovered adapter independently - one
    adapter raising/returning [] must never reduce another's contribution."""
    from api.pipeline import fetch_listings
    from core.parser import Rule

    amazon_listing = Listing(source="amazon", product_id="A1", title="A laptop",
                              url="https://amazon.in/x", price=45000)

    with patch("adapters.amazon.AmazonAdapter.search", return_value=[amazon_listing]), \
         patch("adapters.quickcommerce.QuickCommerceAdapter.search",
               side_effect=RuntimeError("simulated quickcommerce crash")):
        # QuickCommerceAdapter's own search() never actually raises (every
        # request is try/except-guarded internally) - this simulates it
        # doing so anyway (a bug, or some future adapter that isn't as
        # careful) to prove fetch_listings' loop itself won't let that cost
        # the results already collected from Amazon.
        result = fetch_listings({"product_type": Rule(value="laptop", op="==", elastic=False, confidence=.9)})
    assert len(result) == 1
    assert result[0].source == "amazon"


def test_amazon_failure_does_not_affect_quickcommerce(monkeypatch):
    from api.pipeline import fetch_listings
    from core.parser import Rule

    # build_all() constructs a real QuickCommerceAdapter() instance before
    # any @patch on its methods applies - without a key in the environment
    # its __init__ raises AdapterUnavailable and it never joins the adapter
    # list at all, which would make this test pass for the wrong reason.
    monkeypatch.setenv("QUICKCOMMERCE_API_KEY", "test-key-123")

    qc_listing = Listing(source="quickcommerce", platform="Flipkart", product_id="FK1",
                          title="A mouse", url="https://flipkart.com/x", price=999)

    with patch("adapters.amazon.AmazonAdapter.search", return_value=[]), \
         patch("adapters.quickcommerce.QuickCommerceAdapter.search", return_value=[qc_listing]):
        result = fetch_listings(
            {"product_type": Rule(value="mouse", op="==", elastic=False, confidence=.9)},
            lat=12.9, lon=77.6, platforms=["Flipkart"],
        )
    assert len(result) == 1
    assert result[0].platform == "Flipkart"


# --- 12. multiple platform comparison ------------------------------------------

def test_multiple_platforms_all_requested_and_merged(monkeypatch):
    adapter = _adapter(monkeypatch)
    flipkart_raw = {**FLIPKART_RESULT, "id": "FK1", "platform": "Flipkart"}
    myntra_raw = {**FLIPKART_RESULT, "id": "MY1", "platform": "Myntra", "name": "Test Shirt"}

    def fake_fetch(url, params, **kwargs):
        platform = params["platform"]
        raw = flipkart_raw if platform == "Flipkart" else myntra_raw
        return {"results": [raw]}, False

    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", side_effect=fake_fetch) as mock_fetch:
        result = adapter.search("item", lat=12.9, lon=77.6, platforms=["Flipkart", "Myntra"])

    assert mock_fetch.call_count == 2  # exactly one billed request per requested platform
    platforms_returned = {l.platform for l in result}
    assert platforms_returned == {"Flipkart", "Myntra"}


# --- 13. empty search results --------------------------------------------------

def test_empty_results_returns_empty_list(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", return_value=({"results": []}, False)):
        result = adapter.search("nonexistent item xyz", lat=12.9, lon=77.6, platforms=["Flipkart"])
    assert result == []


# --- 14. malformed provider response --------------------------------------------

def test_malformed_response_shape_returns_empty(monkeypatch):
    adapter = _adapter(monkeypatch)
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", return_value=({"totally": "unexpected shape"}, False)):
        result = adapter.search("mouse", lat=12.9, lon=77.6, platforms=["Flipkart"])
    assert result == []


def test_malformed_result_row_is_skipped_not_fatal(monkeypatch):
    """One bad row (missing identity fields) must not cost the rest, same
    policy as amazon.py."""
    adapter = _adapter(monkeypatch)
    good = FLIPKART_RESULT
    bad = {"id": None, "name": None}  # no identity fields at all
    with patch.object(qc, "fetch_supported_platforms", return_value=list(qc.KNOWN_PLATFORMS)), \
         patch("core.cache.fetch_json", return_value=({"results": [bad, good]}, False)):
        result = adapter.search("mouse", lat=12.9, lon=77.6, platforms=["Flipkart"])
    assert len(result) == 1
    assert result[0].product_id == "FK123"


# --- normalization layer, unit-level ---------------------------------------

def test_extract_results_handles_bare_list():
    assert qc._extract_results([{"id": 1}]) == [{"id": 1}]


def test_extract_results_handles_wrapper_keys():
    assert qc._extract_results({"products": [{"id": 1}]}) == [{"id": 1}]
    assert qc._extract_results({"data": [{"id": 1}]}) == [{"id": 1}]


def test_extract_results_returns_none_for_unrecognised_shape():
    assert qc._extract_results({"weird": "shape"}) is None


def test_price_falls_back_to_mrp_when_no_offer_price():
    assert qc._price({"offer_price": None, "mrp": 500}) == 500
    assert qc._price({"offer_price": 400, "mrp": 500}) == 400


def test_stock_out_of_stock_when_available_false():
    assert qc._stock({"available": False, "inventory": 5}) == 0


def test_stock_uses_inventory_count_when_available():
    assert qc._stock({"available": True, "inventory": 7}) == 7


def test_stock_unknown_when_no_signal():
    assert qc._stock({"available": True}) is None


def test_delivery_days_none_when_field_absent():
    assert qc._delivery_days({"id": 1}) is None


def test_supported_platforms_fallback_used_on_failure(monkeypatch):
    monkeypatch.setenv("QUICKCOMMERCE_API_KEY", "k")
    with patch("core.cache.fetch_json", side_effect=requests.ConnectionError("down")):
        result = qc.fetch_supported_platforms()
    assert result is None  # caller (search) falls back to KNOWN_PLATFORMS, never crashes


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
