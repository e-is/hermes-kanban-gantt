"""Shared in-memory task board + the payload contract.

SPIKE ONLY. The payload shape below is a STAND-IN for the real contract.
The sibling audit task (was t_cb748994, reseeded board -> t_b9555592) is
mapping the real poller endpoint; when it lands, replace `payload()` here with
the real response body and the rest of the prototype keeps working (that is the
point of the spike).

Contract (identical bytes for both transports):
{
  "revision": <int>,          # monotonic, bumped on every mutation
  "server_time": <float>,     # epoch seconds when this payload was produced
  "data_time": <float>,       # epoch seconds when the underlying data last
                              # changed -> (recv - data_time) is the true
                              # staleness/freshness lag the user experiences
  "tasks": [ {"id","title","status","updated_at"}, ... ]
}
"""
from __future__ import annotations

import itertools
import threading
import time

STATUSES = ["todo", "ready", "running", "blocked", "done"]


def payload(revision: int, tasks: list[dict], data_time: float | None = None) -> dict:
    """The one true payload shape. Both the poller and the ws push use this."""
    now = time.time()
    return {
        "revision": revision,
        "server_time": now,
        "data_time": data_time if data_time is not None else now,
        "tasks": tasks,
    }


class Board:
    """Thread-safe toy data source standing in for the production DB."""

    def __init__(self, n_tasks: int = 25) -> None:
        self._lock = threading.Lock()
        self._rev = 0
        self._data_time = time.time()
        self._tasks = [
            {
                "id": f"t_{i:03d}",
                "title": f"Demo task {i}",
                "status": STATUSES[i % len(STATUSES)],
                "updated_at": time.time(),
            }
            for i in range(n_tasks)
        ]
        self._counter = itertools.count()

    def revision(self) -> int:
        with self._lock:
            return self._rev

    def snapshot(self) -> dict:
        with self._lock:
            return payload(
                self._rev,
                [dict(t) for t in self._tasks],
                data_time=self._data_time,
            )

    def mutate(self) -> dict:
        """Bump one task. Returns the new payload (with its own server_time)."""
        with self._lock:
            i = next(self._counter) % len(self._tasks)
            self._tasks[i]["status"] = STATUSES[next(self._counter) % len(STATUSES)]
            self._tasks[i]["updated_at"] = time.time()
            self._rev += 1
            self._data_time = time.time()
            return payload(self._rev, [dict(t) for t in self._tasks],
                           data_time=self._data_time)
