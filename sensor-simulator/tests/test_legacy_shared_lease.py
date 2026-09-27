from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from aircheck_simulator_3d.networking.process_lease import (
    SimulatorProcessLease as HeadlessProcessLease,
)
from simulator_lease import SimulatorProcessLease as LegacyProcessLease


def assert_other_runtime_cannot_acquire(
    repo_root: Path, lock_directory: Path, device_id: str, runtime: str
) -> None:
    script = """
import sys
if sys.argv[3] == "headless":
    from aircheck_simulator_3d.networking.process_lease import SimulatorLeaseError, SimulatorProcessLease
else:
    from simulator_lease import SimulatorLeaseError, SimulatorProcessLease
lease = SimulatorProcessLease(sys.argv[1], sys.argv[2])
try:
    lease.acquire()
except SimulatorLeaseError:
    print("blocked")
else:
    lease.release()
    print("acquired")
"""
    child_env = os.environ.copy()
    child_env["PYTHONPATH"] = os.pathsep.join(
        (str(repo_root), str(repo_root / "sensor-simulator"))
    )
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
            str(lock_directory),
            device_id,
            runtime,
        ],
        cwd=repo_root,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "blocked"


def test_legacy_and_headless_runtimes_share_one_cross_process_device_lease(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    device_id = "same-room-01"
    legacy = LegacyProcessLease(str(tmp_path), device_id)
    headless = HeadlessProcessLease(str(tmp_path), device_id)
    assert legacy.path == headless.path

    legacy.acquire()
    try:
        assert_other_runtime_cannot_acquire(repo_root, tmp_path, device_id, "headless")
    finally:
        legacy.release()

    headless.acquire()
    try:
        assert_other_runtime_cannot_acquire(repo_root, tmp_path, device_id, "legacy")
    finally:
        headless.release()
