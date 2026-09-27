from pathlib import Path

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.coordinator import SimulationCoordinator


CONFIG_DIR = Path(__file__).parents[1] / "config"


class _Network:
    def __init__(self, config: object, device_id: str) -> None:
        self.config = config
        self.device_id = device_id
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        self._running = True

    def close(self) -> None:
        self._running = False

    def publish_actual_state(self, _: object) -> None:
        pass

    def publish_telemetry(self, _: object) -> None:
        pass

    def acknowledge(self, _: object) -> None:
        pass

    def set_demo_offline(self, _: bool) -> None:
        pass

    def drain_events(self) -> list[object]:
        return []


def make_coordinator() -> SimulationCoordinator:
    config = load_config(CONFIG_DIR, {})
    return SimulationCoordinator(config, _Network(config.backend, config.devices.device_id))  # type: ignore[arg-type]


def test_snapshot_is_canonical_device_and_simulation_state() -> None:
    coordinator = make_coordinator()
    revision, snapshot = coordinator.snapshot()

    assert revision == 0
    assert snapshot["schema_version"] == 1
    assert snapshot["device_id"] == "room-01"
    assert snapshot["window"]["actual_position_percent"] == 0
    assert {sensor["id"] for sensor in snapshot["sensors"]} == {
        "indoor_climate",
        "indoor_particles",
        "outdoor_climate",
        "outdoor_particles",
    }
    assert snapshot["sensors"][0]["readings"]
    assert snapshot["backend"]["forecast"] is None
    coordinator.close()


def test_headless_actions_use_existing_scenario_and_developer_layers() -> None:
    coordinator = make_coordinator()
    coordinator.start()
    try:
        scenario = coordinator.dispatch("scenario", {"scenario_id": "sensor_failure"})
        assert scenario.result(timeout=1)["title"] == "Sensor Failure"
        _, snapshot = coordinator.snapshot()
        failed = next(sensor for sensor in snapshot["sensors"] if sensor["id"] == "indoor_climate")
        assert not failed["online"]

        debug = coordinator.dispatch("debug_set", {"key": "occupancy", "value": 7})
        assert debug.result(timeout=1)["value"] == 7
        _, snapshot = coordinator.snapshot()
        assert snapshot["simulation"]["occupancy"] == 7

        speed = coordinator.dispatch("speed", {"speed": 10})
        assert speed.result(timeout=1)["speed"] == 10
    finally:
        coordinator.close()
    assert not coordinator.running
