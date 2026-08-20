"""FastAPI service wiring: brief in, decision out, over HTTP + a WebSocket feed.

    uvicorn api.main:app --reload

Every write still goes through core/store.py; this layer only orchestrates
when to call it and fans pipeline progress out to WebSocket subscribers.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from api.events import bus
from api.pipeline import resume_pipeline, run_pipeline
from core import store

log = logging.getLogger("api.main")

# Keep references so asyncio doesn't garbage-collect in-flight background tasks.
_background_tasks: set[asyncio.Task] = set()

# Last known pipeline stage per run, process-local (same lifetime as the
# WebSocket bus). SQLite is the durable record; this only closes the gap
# where a field like parsed_rules reads back null because the run hasn't
# reached that stage yet, not because parsing found nothing.
_last_stage: dict[str, str] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus.bind_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="Procurement Agent API", lifespan=lifespan)


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _make_broadcast(run_id: str):
    def broadcast(stage: str, data: dict | None = None) -> None:
        _last_stage[run_id] = stage
        bus.publish(run_id, stage, data)
    return broadcast


class BriefIn(BaseModel):
    text: str


class ApproveIn(BaseModel):
    chosen_option: str


@app.post("/brief")
async def post_brief(body: BriefIn):
    """Starts the pipeline in the background and returns immediately."""
    run_id = store.start_run(body.text)
    _last_stage[run_id] = "queued"
    _spawn(asyncio.to_thread(run_pipeline, run_id, body.text, _make_broadcast(run_id)))
    return {"run_id": run_id}


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    row = store.get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="run not found")
    # SQLite is the source of truth for every field here; `stage` is a
    # process-local hint layered on top so a field that's still null (e.g.
    # parsed_rules before the LLM call returns) doesn't read as "found
    # nothing" when it actually means "hasn't gotten there yet". Lost on
    # restart, same as the WebSocket feed - status/parsed_rules/decisions
    # stay correct from SQLite regardless.
    row["stage"] = _last_stage.get(run_id, row["status"])
    row["pipeline_complete"] = row["status"] in ("completed", "failed")
    return row


@app.get("/runs")
async def list_runs(limit: int = 50):
    return store.list_runs(limit=limit)


@app.post("/runs/{run_id}/approve")
async def approve_run(run_id: str, body: ApproveIn):
    row = store.get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="run not found")
    if row["status"] != "awaiting_approval":
        raise HTTPException(status_code=400,
                            detail=f"run is not awaiting approval (status={row['status']})")

    pending = next((a for a in row["approvals"] if a["chosen_option"] is None), None)
    if pending is None:
        raise HTTPException(status_code=400, detail="no pending approval on this run")

    valid_keys = [o["key"] for o in pending["options"]]
    if body.chosen_option not in valid_keys:
        raise HTTPException(status_code=400,
                            detail=f"chosen_option must be one of {valid_keys}")

    _last_stage[run_id] = "resuming"
    _spawn(asyncio.to_thread(resume_pipeline, run_id, body.chosen_option, _make_broadcast(run_id)))
    return {"run_id": run_id, "status": "resuming"}


@app.websocket("/stream/{run_id}")
async def stream_run(websocket: WebSocket, run_id: str):
    await websocket.accept()

    row = store.get_run(run_id)
    if row is None:
        await websocket.send_json({"run_id": run_id, "stage": "error",
                                    "data": {"reason": "unknown run_id"}})
        await websocket.close()
        return

    # A client connecting after the run already progressed (or finished)
    # still deserves to know where things stand, not silence until the next event.
    await websocket.send_json({"run_id": run_id, "stage": "current_state",
                                "data": {"status": row["status"]}})
    if row["status"] in ("completed", "failed"):
        await websocket.close()
        return

    queue = bus.subscribe(run_id)
    try:
        while True:
            message = await queue.get()
            await websocket.send_json(message)
            if message["stage"] in ("completed", "failed"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(run_id, queue)
