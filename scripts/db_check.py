"""One command to see the state of the world.

    python scripts/db_check.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select  # noqa: E402

from core.db import ALL_MODELS, DB_PATH, SessionLocal  # noqa: E402
from core.sync import get_client, supabase_reachable  # noqa: E402


def main() -> int:
    print(f"ledger: {DB_PATH}" + ("" if DB_PATH.exists() else "  (missing - not written yet)"))
    print()
    print(f"{'table':<20}{'rows':>8}{'unsynced':>11}")
    print("-" * 39)

    total_unsynced = 0
    with SessionLocal() as s:
        for model in ALL_MODELS:
            rows = s.scalar(select(func.count()).select_from(model))
            unsynced = s.scalar(
                select(func.count()).select_from(model).where(model.synced.is_(False))
            )
            total_unsynced += unsynced
            print(f"{model.__tablename__:<20}{rows:>8}{unsynced:>11}")

    print()
    ok, detail = supabase_reachable()
    if ok:
        print(f"supabase: reachable ({detail})")
    elif get_client() is None and "not set" in detail:
        print("supabase: disabled - local-only mode (SUPABASE_URL/SUPABASE_KEY not set)")
    else:
        print(f"supabase: UNREACHABLE - {detail}")

    print(f"pending push: {total_unsynced} row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
