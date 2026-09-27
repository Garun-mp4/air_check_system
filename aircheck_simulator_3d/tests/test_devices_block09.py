from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.coordinator import SimulationCoordinator
from aircheck_simulator_3d.devices.command_executor import DeviceCommandExecutor
from aircheck_simulator_3d.devices.models import WindowMotorState
from aircheck_simulator_3d.networking.contracts import CommandTarget, PendingControlCommand
from aircheck_simulator_3d.simulation.virtual_sensors import (
    SensorReadingUnavailable,
    read_sensor_value,
    read_zone_values,
)
from aircheck_simulator_3d.tests.support import SimulationHarness, new_simulation


CONFIG_DIR = Path(__file__).parents[1] / "config"


def _simulation() -> SimulationHarness:
    return new_simulation(load_config(CONFIG_DIR, {}))


class _IdleNetwork:
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


def test_repeated_window_requests_at_each_limit_leave_motor_stopped() -> None:
    simulation = _simulation()
    devices = simulation.device_layer

    devices.request_window_close()
    devices.request_window_close()
    closed = devices.simulation_state.window
    assert closed.target_position_percent == 0
    assert closed.actual_position_percent == 0
    assert closed.motor_state is WindowMotorState.STOPPED
    assert closed.close_limit_switch
    assert not closed.open_limit_switch
    assert not closed.reed_switch

    devices.request_window_open()
    devices.advance(simulation.config.devices.window_travel_seconds)
    devices.request_window_open()
    devices.request_window_open()
    opened = devices.simulation_state.window
    assert opened.target_position_percent == 100
    assert opened.actual_position_percent == 100
    assert opened.motor_state is WindowMotorState.STOPPED
    assert opened.open_limit_switch
    assert not opened.close_limit_switch
    assert opened.reed_switch


def test_reversing_window_changes_target_without_jumping_actual_position() -> None:
    simulation = _simulation()
    devices = simulation.device_layer

    devices.request_window_open()
    devices.advance(4)
    before_reverse = devices.simulation_state.window
    assert before_reverse.target_position_percent == 100
    assert before_reverse.actual_position_percent == pytest.approx(20)
    assert before_reverse.motor_state is WindowMotorState.OPENING

    devices.request_window_close()
    after_reverse = devices.simulation_state.window
    assert after_reverse.target_position_percent == 0
    assert after_reverse.actual_position_percent == pytest.approx(20)
    assert after_reverse.motor_state is WindowMotorState.CLOSING
    assert not after_reverse.close_limit_switch

    devices.advance(1)
    assert devices.simulation_state.window.actual_position_percent == pytest.approx(15)


@pytest.mark.parametrize(
    ("fan_name", "set_enabled", "set_speed", "set_airflow"),
    [
        ("intake", "set_intake_enabled", "set_intake_speed", "set_intake_airflow"),
        ("exhaust", "set_exhaust_enabled", "set_exhaust_speed", "set_exhaust_airflow"),
    ],
)
def test_fan_commands_keep_enabled_rpm_and_airflow_in_sync(
    fan_name: str,
    set_enabled: str,
    set_speed: str,
    set_airflow: str,
) -> None:
    simulation = _simulation()
    devices = simulation.device_layer
    fan = getattr(devices.simulation_state.ventilation, fan_name)

    assert not fan.enabled
    assert fan.rpm == 0
    assert fan.airflow_m3_h == 0

    getattr(devices, set_enabled)(True)
    fan = getattr(devices.simulation_state.ventilation, fan_name)
    assert fan.enabled
    assert fan.rpm == fan.nominal_rpm
    assert fan.airflow_m3_h == fan.nominal_airflow_m3_h

    getattr(devices, set_speed)(fan.nominal_rpm / 2)
    fan = getattr(devices.simulation_state.ventilation, fan_name)
    assert fan.enabled
    assert fan.rpm == pytest.approx(fan.nominal_rpm / 2)
    assert fan.airflow_m3_h == pytest.approx(fan.nominal_airflow_m3_h / 2)

    getattr(devices, set_airflow)(fan.nominal_airflow_m3_h / 4)
    fan = getattr(devices.simulation_state.ventilation, fan_name)
    assert fan.enabled
    assert fan.airflow_m3_h == pytest.approx(fan.nominal_airflow_m3_h / 4)
    assert fan.rpm == pytest.approx(fan.nominal_rpm / 4)

    getattr(devices, set_enabled)(False)
    stopped = getattr(devices.simulation_state.ventilation, fan_name)
    assert not stopped.enabled
    assert stopped.rpm == 0
    assert stopped.airflow_m3_h == 0


@pytest.mark.parametrize(
    ("target", "fan_name"),
    [(CommandTarget.INTAKE, "intake"), (CommandTarget.EXHAUST, "exhaust")],
)
def test_queued_opposite_fan_commands_complete_in_order_from_actual_state(
    target: CommandTarget,
    fan_name: str,
) -> None:
    simulation = _simulation()
    executor = DeviceCommandExecutor(simulation.device_layer)
    executor.enqueue(PendingControlCommand(901, target, True))
    executor.enqueue(PendingControlCommand(902, target, False))

    assert executor.update() == (901,)
    enabled = getattr(simulation.state.ventilation, fan_name)
    assert enabled.enabled
    assert enabled.rpm == enabled.nominal_rpm
    assert enabled.airflow_m3_h == enabled.nominal_airflow_m3_h

    assert executor.update() == (902,)
    disabled = getattr(simulation.state.ventilation, fan_name)
    assert not disabled.enabled
    assert disabled.rpm == 0
    assert disabled.airflow_m3_h == 0
    assert executor.pending_count == 0


def test_redelivered_window_command_id_stays_single_while_actuator_moves() -> None:
    simulation = _simulation()
    devices = simulation.device_layer
    executor = DeviceCommandExecutor(devices)
    command = PendingControlCommand(903, CommandTarget.WINDOW, True)

    executor.enqueue(command)
    assert executor.update() == ()
    assert executor.pending_count == 1

    executor.enqueue(command)
    assert executor.update() == ()
    assert executor.pending_count == 1
    assert devices.simulation_state.window.actual_position_percent == 0
    assert devices.simulation_state.window.motor_state is WindowMotorState.OPENING

    devices.advance(simulation.config.devices.window_travel_seconds / 2)
    assert executor.update() == ()
    assert devices.simulation_state.window.actual_position_percent == pytest.approx(50)
    assert executor.pending_count == 1

    devices.advance(simulation.config.devices.window_travel_seconds / 2)
    assert executor.update() == (903,)
    assert executor.pending_count == 0


def test_presentation_snapshot_tracks_device_outputs_and_is_immutable() -> None:
    simulation = _simulation()
    devices = simulation.device_layer
    initial = devices.presentation_state

    devices.request_window_open()
    devices.advance(4)
    devices.set_intake_speed(simulation.config.devices.intake_nominal_rpm / 2)
    snapshot = devices.presentation_state

    assert initial.window.actual_position_percent == 0
    assert initial.window.motor_state == WindowMotorState.STOPPED.value
    assert initial.window.close_limit_switch
    assert snapshot.window.actual_position_percent == pytest.approx(20)
    assert snapshot.window.motor_state == WindowMotorState.OPENING.value
    assert snapshot.window.reed_switch
    assert not snapshot.window.open_limit_switch
    assert not snapshot.window.close_limit_switch
    assert snapshot.intake.enabled
    assert snapshot.intake.rpm == pytest.approx(simulation.config.devices.intake_nominal_rpm / 2)
    assert not snapshot.exhaust.enabled
    assert snapshot.exhaust.rpm == 0

    with pytest.raises(FrozenInstanceError):
        snapshot.window.actual_position_percent = 100  # type: ignore[misc]


def test_application_snapshot_serializes_current_window_and_fan_state() -> None:
    config = load_config(CONFIG_DIR, {})
    coordinator = SimulationCoordinator(config, _IdleNetwork(config.backend, config.devices.device_id))  # type: ignore[arg-type]
    try:
        coordinator.devices.request_window_open()
        coordinator.devices.advance(4)
        coordinator.devices.set_intake_speed(config.devices.intake_nominal_rpm / 2)

        revision, snapshot = coordinator.snapshot()

        assert revision == 0
        assert snapshot["window"] == {
            "target_position_percent": 100,
            "actual_position_percent": pytest.approx(20),
            "motor_state": WindowMotorState.OPENING.value,
            "reed_switch": True,
            "open_limit_switch": False,
            "close_limit_switch": False,
        }
        assert snapshot["ventilation"]["intake"]["enabled"]
        assert snapshot["ventilation"]["intake"]["rpm"] == pytest.approx(
            config.devices.intake_nominal_rpm / 2
        )
        assert snapshot["ventilation"]["intake"]["airflow_m3_h"] == pytest.approx(
            config.devices.intake_airflow_m3_h / 2
        )
        assert not snapshot["ventilation"]["exhaust"]["enabled"]
    finally:
        coordinator.close()


def test_application_snapshot_marks_offline_sensor_readings_unavailable() -> None:
    config = load_config(CONFIG_DIR, {})
    coordinator = SimulationCoordinator(config, _IdleNetwork(config.backend, config.devices.device_id))  # type: ignore[arg-type]
    try:
        coordinator.simulation.state.sensors = tuple(
            replace(sensor, online=False) if sensor.sensor_id == "indoor_climate" else sensor
            for sensor in coordinator.simulation.state.sensors
        )

        _, snapshot = coordinator.snapshot()

        failed_sensor = next(sensor for sensor in snapshot["sensors"] if sensor["id"] == "indoor_climate")
        assert not failed_sensor["online"]
        assert failed_sensor["readings"] == {"co2": None, "temperature": None, "humidity": None}
    finally:
        coordinator.close()


@pytest.mark.parametrize(
    ("zone", "expected_measurements"),
    [
        ("indoor", {"co2", "pm25", "temperature", "humidity"}),
        ("outdoor", {"pm25", "temperature", "humidity"}),
    ],
)
def test_virtual_sensor_values_map_to_the_configured_zone_measurements(
    zone: str,
    expected_measurements: set[str],
) -> None:
    state = _simulation().state

    values = read_zone_values(state, zone)
    source = state.indoor if zone == "indoor" else state.outdoor

    assert set(values) == expected_measurements
    assert values["pm25"] == source.pm25_ug_m3
    assert values["temperature"] == source.temperature_c
    assert values["humidity"] == source.humidity_percent
    if zone == "indoor":
        assert values["co2"] == source.co2_ppm


def test_virtual_sensor_rejects_unavailable_and_unsupported_measurements() -> None:
    state = _simulation().state

    with pytest.raises(SensorReadingUnavailable, match="no voc sensor is configured"):
        read_sensor_value(state, "indoor", "voc")

    state.sensors = tuple(
        replace(sensor, measurements=(*sensor.measurements, "voc"))
        if sensor.sensor_id == "indoor_particles"
        else sensor
        for sensor in state.sensors
    )
    with pytest.raises(SensorReadingUnavailable, match="unsupported virtual sensor measurement: voc"):
        read_sensor_value(state, "indoor", "voc")


def test_offline_sensor_prevents_zone_readings_instead_of_returning_stale_values() -> None:
    state = _simulation().state
    state.sensors = tuple(
        replace(sensor, online=False) if sensor.sensor_id == "indoor_climate" else sensor
        for sensor in state.sensors
    )

    with pytest.raises(SensorReadingUnavailable, match="is offline"):
        read_zone_values(state, "indoor")
