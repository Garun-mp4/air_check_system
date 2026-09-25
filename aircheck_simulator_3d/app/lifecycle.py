from __future__ import annotations

from collections.abc import Callable


class Lifecycle:
    """Owns app resources and releases them once, in reverse creation order."""

    def __init__(self) -> None:
        self._cleanups: list[Callable[[], None]] = []
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    def add_cleanup(self, cleanup: Callable[[], None]) -> None:
        if self._closed:
            raise RuntimeError("cannot register a cleanup after shutdown")
        self._cleanups.append(cleanup)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        errors: list[Exception] = []
        while self._cleanups:
            cleanup = self._cleanups.pop()
            try:
                cleanup()
            except Exception as exc:  # continue closing remaining resources
                errors.append(exc)
        if errors:
            raise ExceptionGroup("one or more application resources failed to close", errors)

    def __enter__(self) -> Lifecycle:
        if self._closed:
            raise RuntimeError("application lifecycle is already closed")
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        self.close()
        return False
