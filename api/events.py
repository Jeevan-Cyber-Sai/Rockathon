"""In-process pub/sub for the pipeline -> WebSocket bridge.

The pipeline runs in a worker thread (parse_brief/adapter calls are blocking),
so publishing has to be thread-safe with respect to the asyncio event loop
that owns the WebSocket connections.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers[run_id].append(q)
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue) -> None:
        subs = self._subscribers.get(run_id)
        if not subs:
            return
        if q in subs:
            subs.remove(q)
        if not subs:
            self._subscribers.pop(run_id, None)

    def publish(self, run_id: str, stage: str, data: dict | None = None) -> None:
        """Safe to call from a worker thread."""
        message = {"run_id": run_id, "stage": stage, "data": data or {}}
        queues = list(self._subscribers.get(run_id, ()))
        if not queues or self._loop is None:
            return
        for q in queues:
            self._loop.call_soon_threadsafe(q.put_nowait, message)


bus = EventBus()
