from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from aircheck_simulator_3d.app.automatic_demo import AutomaticDemoController
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.developer_controls import DeveloperControls
from aircheck_simulator_3d.app.scenarios import ScenarioController
from aircheck_simulator_3d.networking.contracts import BackendForecast, MeasurementPayload
from aircheck_simulator_3d.simulation.virtual_sensors import SensorReadingUnavailable, read_sensor_value
from aircheck_simulator_3d.tests.support import SimulationHarness, new_simulation


CONFIG_DIR = Path(__file__).parents[1] / "config"


def _simulation() -> SimulationHarness:
    return new_simulation(load_config(CONFIG_DIR, {}))


def test_all_demo_scenarios_apply_their_configured_environment_and_device_states() -> None:
    simulation = _simulation()
    scenarios = ScenarioController(
        simulation.config, simulation.simulation_engine, simulation.device_layer, None
    )

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
        state = simulation.state
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
    simulation = _simulation()
    controls = DeveloperControls(simulation.config, simulation.simulation_engine, simulation.device_layer)

    assert controls.adjust("occupancy", 1) == 2
    assert simulation.state.environment.occupancy == 2
    assert controls.adjust("outdoor_co2_ppm", 1) == 470
    assert controls.adjust("wind_speed_m_s", 1) == 1.5
    assert controls.adjust("filter_efficiency", -1) == pytest.approx(0.77)
    assert controls.adjust("intake_airflow_m3_h", 1) == 5
    assert simulation.state.ventilation.intake.enabled
    assert simulation.state.ventilation.intake.airflow_m3_h == 5

    for _ in range(30):
        value = controls.adjust("outdoor_pm25_ug_m3", -1)
    assert value == 0
    assert simulation.state.outdoor.pm25_ug_m3 == 0
    assert controls.step_simulation_speed(-1) == 0
    assert simulation.state.simulation_speed == 0


def test_sensor_failure_withholds_readings_and_telemetry() -> None:
    simulation = _simulation()
    scenarios = ScenarioController(
        simulation.config, simulation.simulation_engine, simulation.device_layer, None
    )
    scenarios.apply("sensor_failure")

    with pytest.raises(SensorReadingUnavailable, match="is offline"):
        read_sensor_value(simulation.state, "indoor", "co2")
    with pytest.raises(SensorReadingUnavailable):
        MeasurementPayload.from_state(simulation.state, datetime.now(timezone.utc))


def test_virtual_sensor_noise_is_deterministic_and_limited_to_reported_readings() -> None:
    simulation = _simulation()
    state = simulation.state
    state.elapsed_seconds = 13.5
    base_co2 = state.indoor.co2_ppm
    state.sensor_noise_percent = 5
    first = read_sensor_value(state, "indoor", "co2")
    second = read_sensor_value(state, "indoor", "co2")

    assert first == second
    assert abs(first - base_co2) <= base_co2 * 0.05
    assert state.indoor.co2_ppm == base_co2


def test_automatic_demo_waits_for_forecast_command_execution_ack_and_air_response() -> None:
    simulation = _simulation()
    demo = AutomaticDemoController(simulation.config.demo)
    state = simulation.state
    demo.start(state)
    assert demo.status.phase == demo.BUILDUP

    state.elapsed_seconds += simulation.config.demo.automatic_build_up_seconds
    state.indoor.co2_ppm = 1000
    assert demo.update(state, backend_online=False).detail.startswith("Backend offline")
    demo.update(state, backend_online=True)
    demo.forecast_received(BackendForecast(1280, model_name="linear_regression"))
    assert demo.status.phase == demo.FORECAST
    demo.command_received(77)
    demo.command_received(78)
    assert demo.status.phase == demo.COMMAND
    demo.command_started(77)
    assert demo.status.phase == demo.EXECUTING
    demo.command_applied((77,))
    assert demo.status.phase == demo.WAITING_ACK
    demo.acknowledgement_accepted((77,))
    assert demo.status.phase == demo.WAITING_ACK
    demo.command_applied(())
    demo.command_applied((78,))
    demo.acknowledgement_accepted((78,))
    assert demo.status.phase == demo.ACKNOWLEDGED
    demo.command_applied(())
    assert demo.status.phase == demo.ACKNOWLEDGED

    state.indoor.co2_ppm = 970
    completed = demo.update(state, backend_online=True)
    assert completed.phase == demo.COMPLETE
    assert not completed.active


def test_automatic_demo_weather_allows_real_ventilation_to_reduce_co2() -> None:
    simulation = _simulation()
    scenario = ScenarioController(
        simulation.config, simulation.simulation_engine, simulation.device_layer, None
    )
    scenario.prepare_automatic_demo()
    state = simulation.state
    simulation.simulation_engine.set_speed(60.0)
    baseline = state.indoor.co2_ppm

    _run_simulated_seconds(simulation, simulation.config.demo.automatic_build_up_seconds)
    peak = state.indoor.co2_ppm
    assert peak > baseline
    assert state.window.close_limit_switch

    simulation.device_layer.request_window_open()
    simulation.device_layer.set_intake_enabled(True)
    simulation.device_layer.set_exhaust_enabled(True)
    _run_simulated_seconds(simulation, simulation.config.devices.window_travel_seconds + 1)
    assert state.window.open_limit_switch
    _run_simulated_seconds(simulation, 15 * 60)

    assert state.indoor.co2_ppm <= peak - simulation.config.demo.automatic_co2_drop_ppm


def _run_simulated_seconds(simulation: SimulationHarness, simulated_seconds: float) -> None:
    state = simulation.state
    remaining_ticks = round(simulated_seconds / state.fixed_step_seconds)
    while remaining_ticks:
        ticks = min(remaining_ticks, simulation.config.physics.max_substeps_per_frame)
        real_seconds = ticks * state.fixed_step_seconds / state.simulation_speed
        assert simulation.simulation_engine.advance(real_seconds) == ticks
        remaining_ticks -= ticks
