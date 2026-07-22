from __future__ import annotations

import threading
from collections import deque
from contextlib import contextmanager
from typing import Iterator


class SimplePsycopgPool:
    """A tiny connection pool good enough for the hackathon app.

    It avoids opening a fresh Postgres connection for every query path while
    keeping dependencies minimal.
    """

    def __init__(self, database_url: str, max_size: int = 4) -> None:
        self.database_url = database_url
        self.max_size = max(max_size, 1)
        self._idle: deque = deque()
        self._created = 0
        self._lock = threading.Condition()

    @contextmanager
    def connection(self) -> Iterator[object]:
        connection = self._acquire()
        try:
            yield connection
        finally:
            self._release(connection)

    def _acquire(self):
        import psycopg

        with self._lock:
            while True:
                while self._idle:
                    connection = self._idle.pop()
                    try:
                        if getattr(connection, "closed", False):
                            self._created -= 1
                            continue
                    except Exception:
                        self._created -= 1
                        continue
                    return connection

                if self._created < self.max_size:
                    self._created += 1
                    break

                self._lock.wait(timeout=5.0)

        return psycopg.connect(self.database_url)

    def _release(self, connection) -> None:
        with self._lock:
            try:
                if getattr(connection, "closed", False):
                    self._created = max(self._created - 1, 0)
                else:
                    self._idle.append(connection)
            finally:
                self._lock.notify()


_POOLS: dict[str, SimplePsycopgPool] = {}
_POOLS_LOCK = threading.Lock()


def get_postgres_pool(database_url: str | None, max_size: int = 4) -> SimplePsycopgPool | None:
    if not database_url:
        return None
    with _POOLS_LOCK:
        pool = _POOLS.get(database_url)
        if pool is None:
            pool = SimplePsycopgPool(database_url=database_url, max_size=max_size)
            _POOLS[database_url] = pool
        return pool
