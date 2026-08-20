"""The contract every retailer adapter implements, plus discovery.

Adding a retailer means dropping one file into adapters/ that subclasses
VendorAdapter. Nothing else in the codebase changes: discover() finds it.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from abc import ABC, abstractmethod

from .models import Listing

log = logging.getLogger("adapter")


class AdapterUnavailable(RuntimeError):
    """Raised from __init__ when an adapter cannot run (usually a missing key).

    Not an error the app should die on - the builder logs it and moves on.
    """


class VendorAdapter(ABC):
    name: str = "unnamed"

    @abstractmethod
    def search(self, query: str, max_results: int = 30) -> list[Listing]:
        """Return listings for a query. Must return [] on failure, never raise."""

    def __repr__(self) -> str:
        return f"<{type(self).__name__} name={self.name!r}>"


def discover() -> list[type[VendorAdapter]]:
    """Import every module in adapters/ and collect the concrete subclasses."""
    import adapters

    for mod in pkgutil.iter_modules(adapters.__path__):
        if mod.name.startswith("_"):
            continue
        try:
            importlib.import_module(f"adapters.{mod.name}")
        except Exception as exc:
            log.warning("could not import adapters.%s: %s", mod.name, exc)

    found, seen = [], set()
    stack = list(VendorAdapter.__subclasses__())
    while stack:
        cls = stack.pop()
        stack.extend(cls.__subclasses__())
        if cls.__name__ in seen or getattr(cls, "__abstractmethods__", None):
            continue
        seen.add(cls.__name__)
        found.append(cls)
    return sorted(found, key=lambda c: c.name)


def build_all(**kwargs) -> list[VendorAdapter]:
    """Instantiate every usable adapter. Unusable ones are logged, not fatal."""
    adapters_out = []
    for cls in discover():
        try:
            adapters_out.append(cls(**kwargs))
        except AdapterUnavailable as exc:
            log.warning("adapter %s unavailable: %s", cls.name, exc)
        except Exception as exc:
            log.warning("adapter %s failed to start: %s", cls.name, exc)
    return adapters_out
