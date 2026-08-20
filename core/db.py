"""SQLAlchemy models + engine for the local-first procurement ledger.

Everything the agent does lands here first, synchronously. The `synced` flag is
local-only bookkeeping for core/sync.py; it does not exist in Supabase.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    create_engine,
    event,
    Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

# --- paths -----------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("LEDGER_DB_PATH", PROJECT_ROOT / "data" / "ledger.db"))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """JSON maps to SQLite TEXT here and to jsonb in Supabase."""


# --- models ----------------------------------------------------------------


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    brief_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed_rules: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    chosen: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total_cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latest_delivery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    runner_up: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    why_rejected: Mapped[str | None] = mapped_column(Text, nullable=True)
    counterfactual: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    synced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ListingsSnapshot(Base):
    __tablename__ = "listings_snapshot"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    listings: Mapped[list | dict | None] = mapped_column(JSON, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    synced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[list | dict | None] = mapped_column(JSON, nullable=True)
    chosen_option: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    synced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


# Sync scans "give me everything not yet pushed"; these keep that cheap.
Index("ix_runs_synced", Run.synced)
Index("ix_decisions_synced", Decision.synced)
Index("ix_decisions_run_id", Decision.run_id)
Index("ix_listings_snapshot_synced", ListingsSnapshot.synced)
Index("ix_listings_snapshot_run_id", ListingsSnapshot.run_id)
Index("ix_approvals_synced", Approval.synced)
Index("ix_approvals_run_id", Approval.run_id)

ALL_MODELS = (Run, Decision, ListingsSnapshot, Approval)

# --- engine ----------------------------------------------------------------

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    future=True,
    # The sync thread and the main app share this engine.
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    """WAL lets the sync thread read while the app writes; no blocking either way."""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db() -> None:
    """Idempotent; safe to call on every import/startup."""
    Base.metadata.create_all(engine)


init_db()
