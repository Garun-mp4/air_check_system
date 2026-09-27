from __future__ import annotations

import pytest

from aircheck_simulator_3d.networking.process_lease import SimulatorLeaseError, SimulatorProcessLease


def test_process_lease_rejects_a_second_runtime_for_the_same_device(tmp_path):
    first = SimulatorProcessLease(str(tmp_path), "room-01")
    second = SimulatorProcessLease(str(tmp_path), "room-01")
    first.acquire()
    try:
        with pytest.raises(SimulatorLeaseError):
            second.acquire()
    finally:
        first.release()
    second.acquire()
    second.release()


def test_distinct_devices_have_independent_locks(tmp_path):
    first = SimulatorProcessLease(str(tmp_path), "room-01")
    second = SimulatorProcessLease(str(tmp_path), "room-02")
    first.acquire()
    second.acquire()
    first.release()
    second.release()
