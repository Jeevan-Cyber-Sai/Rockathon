"""Background push of unsynced local rows to Supabase.

Nothing in here is allowed to raise into the app. If Supabase is missing,
misconfigured, or unreachable, the worker logs and tries again next cycle;
the app keeps writing to SQLite the whole time.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import select, update

from .db import ALL_MODELS, SessionLocal

log = logging.getLogger("sync")

load_dotenv()

SYNC_INTERVAL_SECONDS = 10
BATCH_SIZE = 200

# Parents before children, so Supabase's foreign keys are satisfied on arrival.
PUSH_ORDER = ["runs", "listings_snapshot", "decisions", "approvals"]
_MODELS = {m.__tablename__: m for m in ALL_MODELS}

_client = None
_worker: "SyncWorker | None" = None


def _credentials() -> tuple[str | None, str | None]:
    return os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY")


def get_client():
    """None means local-only mode. Never raises."""
    global _client
    if _client is not None:
        return _client
    url, key = _credentials()
    if not url or not key:
        return None
    try:
        from supabase import create_client  # imported late; may not be installed
    except ImportError:
        log.info("supabase-py not installed - running local-only")
        return None
    try:
        _client = create_client(url, key)
    except Exception as exc:  # bad url, bad key, anything
        log.warning("supabase client init failed: %s", exc)
        return None
    return _client


def _jsonable(value):
    if isinstance(value, datetime):
        # SQLite hands back naive datetimes; we always store UTC, so say so
        # explicitly rather than let Postgres guess a timezone for timestamptz.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value


def _payload(row) -> dict:
    """Row as Supabase sees it: every column except the local-only synced flag."""
    return {
        c.key: _jsonable(getattr(row, c.key))
        for c in row.__table__.columns
        if c.key != "synced"
    }


def push_once() -> int:
    """One sync pass. Returns rows pushed; 0 if disabled or nothing pending."""
    client = get_client()
    if client is None:
        return 0

    pushed = 0
    for table in PUSH_ORDER:
        model = _MODELS[table]
        with SessionLocal() as s:
            rows = list(
                s.scalars(select(model).where(model.synced.is_(False)).limit(BATCH_SIZE))
            )
            if not rows:
                continue
            sent = {r.id: _payload(r) for r in rows}
            ids, payload = list(sent), list(sent.values())

        try:
            client.table(table).upsert(payload).execute()
        except Exception as exc:
            log.warning("push %s failed (%d rows), retrying next cycle: %s", table, len(ids), exc)
            # Children reference runs; if a parent table failed, stop here so we
            # don't burn a round trip on rows that would violate a foreign key.
            break

        try:
            with SessionLocal() as s:
                # The app may have updated a row while it was in flight. Only
                # clear the flag on rows that still match what we pushed; the
                # rest stay unsynced and go out next cycle.
                fresh = s.scalars(select(model).where(model.id.in_(ids)))
                done = [r.id for r in fresh if _payload(r) == sent[r.id]]
                if done:
                    s.execute(update(model).where(model.id.in_(done)).values(synced=True))
                    s.commit()
            pushed += len(done)
        except Exception as exc:
            # Pushed but not marked: the upsert is idempotent, so a repeat is safe.
            log.warning("marking %s synced failed: %s", table, exc)

    return pushed


class SyncWorker(threading.Thread):
    def __init__(self, interval: int = SYNC_INTERVAL_SECONDS):
        super().__init__(name="supabase-sync", daemon=True)
        self.interval = interval
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                n = push_once()
                if n:
                    log.info("synced %d rows", n)
            except Exception as exc:  # belt and braces; the thread must not die
                log.warning("sync cycle error: %s", exc)
            self._stop.wait(self.interval)

    def stop(self) -> None:
        self._stop.set()


def start_sync(interval: int = SYNC_INTERVAL_SECONDS) -> bool:
    """Start the worker. False means local-only mode; the app carries on either way."""
    global _worker
    if _worker is not None and _worker.is_alive():
        return True
    if get_client() is None:
        url, key = _credentials()
        if not url or not key:
            log.info("SUPABASE_URL/SUPABASE_KEY not set - running local-only")
        return False
    _worker = SyncWorker(interval)
    _worker.start()
    return True


def stop_sync() -> None:
    global _worker
    if _worker is not None:
        _worker.stop()
        _worker = None


def unsynced_counts() -> dict[str, int]:
    from sqlalchemy import func

    out = {}
    with SessionLocal() as s:
        for table in PUSH_ORDER:
            model = _MODELS[table]
            out[table] = s.scalar(
                select(func.count()).select_from(model).where(model.synced.is_(False))
            )
    return out


def supabase_reachable(timeout: float = 5.0) -> tuple[bool, str]:
    """Cheap REST ping. Returns (ok, detail). Used by scripts/db_check.py only."""
    import urllib.error
    import urllib.request

    url, key = _credentials()
    if not url or not key:
        return False, "SUPABASE_URL/SUPABASE_KEY not set"
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/runs?select=id&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        detail = f"HTTP {exc.code}"
        if exc.code in (401, 403):
            return False, f"{detail} - key rejected"
        if exc.code == 404:
            return False, f"{detail} - reachable, but table 'runs' is missing"
        return False, detail
    except Exception as exc:
        return False, str(exc)
