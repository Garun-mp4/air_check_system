from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import BinaryIO


class SimulatorLeaseError(RuntimeError):
    """Another simulator process already owns this device's shared lease."""


class SimulatorProcessLease:
    """Cross-process lock shared by the legacy and headless Compose simulators."""

    def __init__(self, directory: str | None, device_id: str) -> None:
        self.path: Path | None = None
        self._stream: BinaryIO | None = None
        if directory and directory.strip():
            safe_id = hashlib.sha256(device_id.encode("utf-8")).hexdigest()[:24]
            self.path = Path(directory).expanduser() / f"{safe_id}.lock"

    def acquire(self) -> None:
        if self.path is None or self._stream is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open("a+b")
        try:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt

                if self.path.stat().st_size == 0:
                    stream.write(b"\0")
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError) as exc:
            stream.close()
            raise SimulatorLeaseError(
                f"device {self.path.stem} is already served by another simulator process"
            ) from exc
        stream.seek(0)
        stream.truncate()
        stream.write(f"pid={os.getpid()}\n".encode("ascii"))
        stream.flush()
        self._stream = stream

    def release(self) -> None:
        stream, self._stream = self._stream, None
        if stream is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        finally:
            stream.close()

    def __enter__(self) -> SimulatorProcessLease:
        self.acquire()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.release()
