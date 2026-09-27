from __future__ import annotations

import pytest

from simulator_lease import SimulatorLeaseError, SimulatorProcessLease


def test_only_one_process_lease_can_own_a_device(tmp_path):
    first = SimulatorProcessLease(str(tmp_path), "room-01")
    second = SimulatorProcessLease(str(tmp_path), "room-01")

    first.acquire()
    try:
        with pytest.raises(SimulatorLeaseError, match="already served"):
            second.acquire()
    finally:
        first.release()

    second.acquire()
    second.release()


def test_different_devices_use_different_lease_files(tmp_path):
    room_a = SimulatorProcessLease(str(tmp_path), "room-a")
    room_b = SimulatorProcessLease(str(tmp_path), "room-b")
    room_a.acquire()
    room_b.acquire()
    room_a.release()
    room_b.release()
