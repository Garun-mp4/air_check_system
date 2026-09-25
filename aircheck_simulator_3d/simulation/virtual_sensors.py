from __future__ import annotations

import math

from aircheck_simulator_3d.simulation.state import SimulationState


class SensorReadingUnavailable(ValueError):
    """Raised when an offline or missing virtual sensor cannot provide a value."""


def read_sensor_value(state: SimulationState, zone: str, measurement: str) -> float:
    sensor = next(
        (
            item
            for item in state.sensors
            if item.zone == zone and measurement in item.measurements
        ),
        None,
    )
    if sensor is None:
        raise SensorReadingUnavailable(f"no {measurement} sensor is configured in {zone}")
    if not sensor.online:
        raise SensorReadingUnavailable(f"{sensor.model} ({sensor.sensor_id}) is offline")

    air = state.indoor if zone == "indoor" else state.outdoor
    value = {
        "co2": air.co2_ppm,
        "pm25": air.pm25_ug_m3,
        "temperature": air.temperature_c,
        "humidity": air.humidity_percent,
    }.get(measurement)
    if value is None:
        raise SensorReadingUnavailable(f"unsupported virtual sensor measurement: {measurement}")

    noise_percent = state.sensor_noise_percent
    if noise_percent:
        phase_seed = sum(ord(character) for character in sensor.sensor_id + measurement)
        phase = phase_seed / 47.0
        drift = 0.65 * math.sin(state.elapsed_seconds * 0.73 + phase)
        drift += 0.35 * math.sin(state.elapsed_seconds * 1.91 + phase * 1.7)
        value *= 1.0 + noise_percent / 100.0 * drift
    if measurement in {"co2", "pm25"}:
        value = max(0.0, value)
    elif measurement == "humidity":
        value = min(100.0, max(0.0, value))
    return value


def read_zone_values(state: SimulationState, zone: str) -> dict[str, float]:
    values: dict[str, float] = {}
    for sensor in state.sensors:
        if sensor.zone != zone:
            continue
        if not sensor.online:
            if sensor.measurements:
                raise SensorReadingUnavailable(f"{sensor.model} ({sensor.sensor_id}) is offline")
            continue
        for measurement in sensor.measurements:
            values[measurement] = read_sensor_value(state, zone, measurement)
    return values
