from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.automatic_demo import AutomaticDemoController
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.developer_controls import DeveloperControls
from aircheck_simulator_3d.app.scenarios import ScenarioController
from aircheck_simulator_3d.networking.contracts import BackendForecast, MeasurementPayload
from aircheck_simulator_3d.presentation.airflow_visualization import (
    active_particle_count,
    flow_ratio,
)
from aircheck_simulator_3d.scene.objects import SceneObject
from aircheck_simulator_3d.simulation.virtual_sensors import SensorReadingUnavailable, read_sensor_value
from aircheck_simulator_3d.ui.presentation_data import device_details, format_hud


CONFIG_DIR = Path(__file__).parents[1] / "config"


def _app() -> Application:
    return Application(load_config(CONFIG_DIR, {}))


def _scene_object(object_id: str) -> SceneObject:
    return SceneObject(object_id, object_id, f"Description for {object_id}", None, None, None, (0, 0, 0))


def test_all_demo_scenarios_apply_their_configured_environment_and_device_states() -> None:
    app = _app()
    scenarios = ScenarioController(app.config, app.simulation_engine, app.device_layer, None)

    assert len(scenarios.scenarios) == 9
    assert [scenario.title for scenario in scenarios.scenarios] == [
        "Normal Room",
        "CO2 Buildup",
        "High Occupancy",
        "Clean Outdoor Air",
        "Polluted Outdoor Air",
        "Cold Weather",
        "High Indoor PM2.5",
        "Sensor Failure",
        "Backend Offline",
    ]
    for preset in scenarios.scenarios:
        selected = scenarios.apply(preset.scenario_id)
        state = app.state
        assert selected == preset
        assert state.environment.occupancy == preset.occupancy
        assert state.outdoor.co2_ppm == preset.outdoor_co2_ppm
        assert state.outdoor.pm25_ug_m3 == preset.outdoor_pm25_ug_m3
        assert state.outdoor.temperature_c == preset.outdoor_temperature_c
        assert state.outdoor.humidity_percent == preset.outdoor_humidity_percent
        assert state.environment.pm25_generation_ug_min == preset.indoor_pm25_generation_ug_min
        assert state.environment.wind_speed_m_s == preset.wind_speed_m_s
        assert state.environment.infiltration_ach == preset.infiltration_ach
        assert state.ventilation.filter_efficiency == preset.filter_efficiency
        assert state.simulation_speed == preset.simulation_speed
        assert all(sensor.online == (sensor.sensor_id not in preset.failed_sensor_ids) for sensor in state.sensors)
        assert not state.ventilation.intake.enabled and not state.ventilation.exhaust.enabled
    scenarios.apply("backend_offline")
    assert scenarios.active_scenario == "Backend Offline"


def test_developer_controls_are_bounded_and_change_the_live_state() -> None:
    app = _app()
    controls = DeveloperControls(app.config, app.simulation_engine, app.device_layer)

    assert controls.adjust("occupancy", 1) == 2
    assert app.state.environment.occupancy == 2
    assert controls.adjust("outdoor_co2_ppm", 1) == 470
    assert controls.adjust("wind_speed_m_s", 1) == 1.5
    assert controls.adjust("filter_efficiency", -1) == pytest.approx(0.77)
    assert controls.adjust("intake_airflow_m3_h", 1) == 5
    assert app.state.ventilation.intake.enabled
    assert app.state.ventilation.intake.airflow_m3_h == 5

    for _ in range(30):
        value = controls.adjust("outdoor_pm25_ug_m3", -1)
    assert value == 0
    assert app.state.outdoor.pm25_ug_m3 == 0
    assert controls.step_simulation_speed(-1) == 0
    assert app.state.simulation_speed == 0


@pytest.mark.parametrize(
    ("flow", "maximum", "ratio", "particles"),
    [(0.0, 60.0, 0.0, 0), (15.0, 60.0, 0.25, 2), (90.0, 60.0, 1.0, 7)],
)
def test_airflow_visual_intensity_tracks_modelled_flow(
    flow: float, maximum: float, ratio: float, particles: int
) -> None:
    assert flow_ratio(flow, maximum) == pytest.approx(ratio)
    assert active_particle_count(flow, maximum, 7) == particles


def test_sensor_panels_and_hud_read_live_virtual_sensor_values() -> None:
    app = _app()
    state = app.state
    state.indoor.co2_ppm = 910
    state.indoor.pm25_ug_m3 = 6.5
    forecast = BackendForecast(1030, model_name="linear_regression")
    expected = {
        "sensor.scd41.indoor": ("Sensirion SCD41", "I²C", "910.0 ppm"),
        "sensor.sps30.indoor": ("Sensirion SPS30", "UART", "6.5 µg/m³"),
        "sensor.sht45.outdoor": ("Sensirion SHT45", "I²C", "18.0 °C"),
        "sensor.sps30.outdoor": ("Sensirion SPS30", "UART", "8.0 µg/m³"),
    }
    for object_id, (model, interface, value) in expected.items():
        _, details = device_details(
            _scene_object(object_id),
            state,
            backend_online=True,
            backend_message=None,
            last_telemetry_at="2026-09-26T10:00:00Z",
            pending_commands=0,
        )
        assert model in details
        assert interface in details
        assert value in details
        assert "Status: ONLINE" in details

    hud = format_hud(state, forecast, True, "Normal Room", "READY")
    assert "910 ppm" in hud
    assert "6.5" in hud
    assert "1030 ppm" in hud
    assert "ONLINE" in hud


@pytest.mark.parametrize(
    "object_id",
    [
        "device.esp32",
        "sensor.scd41.indoor",
        "sensor.sps30.indoor",
        "sensor.sht45.outdoor",
        "sensor.sps30.outdoor",
        "window.assembly",
        "window.actuator",
        "window.reed_switch",
        "window.limit_open",
        "window.limit_close",
        "fan.intake",
        "fan.exhaust",
        "power.psu_12v",
        "power.dc_dc",
        "power.mosfet_module",
        "power.h_bridge",
    ],
)
def test_every_key_device_has_a_live_details_panel(object_id: str) -> None:
    app = _app()
    title, details = device_details(
        _scene_object(object_id),
        app.state,
        backend_online=False,
        backend_message=None,
        last_telemetry_at=None,
        pending_commands=1,
    )

    assert title == object_id
    assert details.strip()
    if object_id == "device.esp32":
        assert "room-01" in details and "Commands executing: 1" in details
    if object_id == "window.actuator":
        assert "Target / actual" in details and "Close limit" in details
    if object_id == "fan.intake":
        assert "Airflow:" in details and "Filter:" in details


def test_sensor_failure_marks_readings_unavailable_and_withholds_telemetry() -> None:
    app = _app()
    scenarios = ScenarioController(app.config, app.simulation_engine, app.device_layer, None)
    scenarios.apply("sensor_failure")

    _, details = device_details(
        _scene_object("sensor.scd41.indoor"),
        app.state,
        backend_online=True,
        backend_message=None,
        last_telemetry_at=None,
        pending_commands=0,
    )
    assert "OFFLINE" in details
    with pytest.raises(SensorReadingUnavailable, match="is offline"):
        read_sensor_value(app.state, "indoor", "co2")
    with pytest.raises(SensorReadingUnavailable):
        MeasurementPayload.from_state(app.state, datetime.now(timezone.utc))


def test_virtual_sensor_noise_is_deterministic_and_limited_to_reported_readings() -> None:
    app = _app()
    state = app.state
    state.elapsed_seconds = 13.5
    base_co2 = state.indoor.co2_ppm
    state.sensor_noise_percent = 5
    first = read_sensor_value(state, "indoor", "co2")
    second = read_sensor_value(state, "indoor", "co2")
    assert first == second
    assert abs(first - base_co2) <= base_co2 * 0.05
    assert state.indoor.co2_ppm == base_co2


def test_automatic_demo_waits_for_real_backend_forecast_command_execution_ack_and_air_response() -> None:
    app = _app()
    demo = AutomaticDemoController(app.config.demo)
    state = app.state
    demo.start(state)
    assert demo.status.phase == demo.BUILDUP

    state.elapsed_seconds += app.config.demo.automatic_build_up_seconds
    state.indoor.co2_ppm = 1000
    assert demo.update(state, backend_online=False).detail.startswith("Backend offline")
    demo.update(state, backend_online=True)
    forecast = BackendForecast(1280, model_name="linear_regression")
    demo.forecast_received(forecast)
    assert demo.status.phase == demo.FORECAST
    demo.command_received(77)
    assert demo.status.phase == demo.COMMAND
    demo.command_started(77)
    assert demo.status.phase == demo.EXECUTING
    demo.command_applied((77,))
    assert demo.status.phase == demo.WAITING_ACK
    demo.acknowledgement_accepted((77,))
    assert demo.status.phase == demo.ACKNOWLEDGED

    state.indoor.co2_ppm = 970
    completed = demo.update(state, backend_online=True)
    assert completed.phase == demo.COMPLETE
    assert not completed.active
