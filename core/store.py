"""The only storage interface the rest of the app uses.

Every write commits to SQLite before returning and leaves synced=False so the
background worker in core/sync.py picks it up. Nothing here touches the network.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .db import (
    Approval,
    Decision,
    ListingsSnapshot,
    Run,
    SessionLocal,
    new_id,
    utcnow,
)

# runs.status values
RUNNING = "running"
AWAITING_APPROVAL = "awaiting_approval"
COMPLETED = "completed"
FAILED = "failed"


# --- writes ----------------------------------------------------------------


def start_run(brief_text: str) -> str:
    """Open a run and hand back its id immediately."""
    run_id = new_id()
    with SessionLocal() as s:
        s.add(Run(id=run_id, brief_text=brief_text, status=RUNNING, synced=False))
        s.commit()
    return run_id


def save_parsed_rules(run_id: str, rules: dict) -> None:
    with SessionLocal() as s:
        run = s.get(Run, run_id)
        if run is None:
            raise KeyError(f"unknown run {run_id}")
        run.parsed_rules = rules
        run.synced = False  # row changed; re-push it
        s.commit()


def save_listings(run_id: str, listings: Any) -> str:
    """Snapshot everything fetched for this run. Returns the snapshot id."""
    snap_id = new_id()
    with SessionLocal() as s:
        s.add(
            ListingsSnapshot(
                id=snap_id,
                run_id=run_id,
                listings=listings,
                fetched_at=utcnow(),
                synced=False,
            )
        )
        s.commit()
    return snap_id


def save_decision(
    run_id: str,
    chosen: dict,
    runner_up: dict | None = None,
    why_rejected: str | None = None,
    counterfactual: str | None = None,
    total_cost: int | None = None,
    latest_delivery: int | None = None,
) -> str:
    """total_cost is whole rupees. latest_delivery is days."""
    decision_id = new_id()
    with SessionLocal() as s:
        s.add(
            Decision(
                id=decision_id,
                run_id=run_id,
                chosen=chosen,
                runner_up=runner_up,
                why_rejected=why_rejected,
                counterfactual=counterfactual,
                total_cost=total_cost,
                latest_delivery=latest_delivery,
                created_at=utcnow(),
                synced=False,
            )
        )
        s.commit()
    return decision_id


def request_approval(run_id: str, question: str, options: list | dict) -> str:
    """Park the run on a human. Returns the approval id."""
    approval_id = new_id()
    with SessionLocal() as s:
        s.add(
            Approval(
                id=approval_id,
                run_id=run_id,
                question=question,
                options=options,
                created_at=utcnow(),
                synced=False,
            )
        )
        run = s.get(Run, run_id)
        if run is not None:
            run.status = AWAITING_APPROVAL
            run.synced = False
        s.commit()
    return approval_id


def record_approval(approval_id: str, chosen_option: str) -> None:
    with SessionLocal() as s:
        approval = s.get(Approval, approval_id)
        if approval is None:
            raise KeyError(f"unknown approval {approval_id}")
        approval.chosen_option = chosen_option
        approval.decided_at = utcnow()
        approval.synced = False
        run = s.get(Run, approval.run_id)
        if run is not None and run.status == AWAITING_APPROVAL:
            run.status = RUNNING  # unblocked; the agent carries on
            run.synced = False
        s.commit()


def complete_run(run_id: str) -> None:
    _finish(run_id, COMPLETED)


def fail_run(run_id: str) -> None:
    """Not in the original list, but 'failed' is otherwise unreachable."""
    _finish(run_id, FAILED)


def _finish(run_id: str, status: str) -> None:
    with SessionLocal() as s:
        run = s.get(Run, run_id)
        if run is None:
            raise KeyError(f"unknown run {run_id}")
        run.status = status
        run.completed_at = utcnow()
        run.synced = False
        s.commit()


# --- reads -----------------------------------------------------------------


def _row(obj) -> dict:
    return {
        c.key: getattr(obj, c.key) for c in obj.__table__.columns
    }


def get_run(run_id: str) -> dict | None:
    """The run plus its decisions, approvals and listing snapshots."""
    with SessionLocal() as s:
        run = s.get(Run, run_id)
        if run is None:
            return None
        out = _row(run)
        out["decisions"] = [
            _row(d)
            for d in s.scalars(
                select(Decision).where(Decision.run_id == run_id).order_by(Decision.created_at)
            )
        ]
        out["approvals"] = [
            _row(a)
            for a in s.scalars(
                select(Approval).where(Approval.run_id == run_id).order_by(Approval.created_at)
            )
        ]
        out["listings"] = [
            _row(l)
            for l in s.scalars(
                select(ListingsSnapshot)
                .where(ListingsSnapshot.run_id == run_id)
                .order_by(ListingsSnapshot.fetched_at)
            )
        ]
        return out


def list_runs(limit: int = 50) -> list[dict]:
    """Newest first. Summary rows only — no children."""
    with SessionLocal() as s:
        rows = s.scalars(select(Run).order_by(Run.created_at.desc()).limit(limit))
        return [_row(r) for r in rows]
