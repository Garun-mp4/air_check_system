from __future__ import annotations

import math
from dataclasses import replace

from aircheck_simulator_3d.app.config import PhysicsConfig, SceneConfig
from aircheck_simulator_3d.devices.models import FanState
from aircheck_simulator_3d.simulation.state import (
    AirflowState,
    AirQualityState,
    EnergyState,
    SimulationState,
)


SECONDS_PER_MINUTE = 60.0
SECONDS_PER_HOUR = 3600.0
LITERS_PER_CUBIC_METER = 1000.0
PPM_PER_FRACTION = 1_000_000.0
CELSIUS_TO_KELVIN = 273.15
JOULES_PER_WATT_HOUR = 3600.0


class RoomModel:
    """Deterministic single-zone, well-mixed contaminant, heat and moisture model."""

    def __init__(self, physics: PhysicsConfig, scene: SceneConfig) -> None:
        self._physics = physics
        self._window_area_m2 = scene.window_width_m * scene.window_height_m

    def step(self, state: SimulationState, delta_seconds: float) -> None:
        if not math.isfinite(delta_seconds) or delta_seconds <= 0:
            raise ValueError("simulation step must be finite and positive")

        room_volume = state.room_volume_m3
        natural_flow = (
            state.environment.infiltration_ach * room_volume
            + self.window_airflow_m3_h(state)
        )
        intake_flow = self._fan_airflow(state.ventilation.intake)
        exhaust_flow = self._fan_airflow(state.ventilation.exhaust)
        mechanical_exchange = max(intake_flow, exhaust_flow)
        total_flow = natural_flow + mechanical_exchange

        state.ventilation = replace(
            state.ventilation,
            intake=replace(state.ventilation.intake, airflow_m3_h=intake_flow),
            exhaust=replace(state.ventilation.exhaust, airflow_m3_h=exhaust_flow),
        )
        state.airflow = AirflowState(
            infiltration_m3_h=state.environment.infiltration_ach * room_volume,
            window_m3_h=max(0.0, natural_flow - state.environment.infiltration_ach * room_volume),
            intake_m3_h=intake_flow,
            exhaust_m3_h=exhaust_flow,
            total_effective_m3_h=total_flow,
            air_changes_per_hour=total_flow / room_volume,
        )

        old = state.indoor
        outside = state.outdoor
        exchange_rate_per_second = total_flow / (SECONDS_PER_HOUR * room_volume)
        co2_generation_ppm_per_second = (
            state.environment.co2_generation_l_min_per_person
            * state.environment.occupancy
            * PPM_PER_FRACTION
            / (LITERS_PER_CUBIC_METER * SECONDS_PER_MINUTE * room_volume)
        )
        co2 = _integrate_mixed_concentration(
            old.co2_ppm,
            outside.co2_ppm,
            co2_generation_ppm_per_second,
            exchange_rate_per_second,
            delta_seconds,
        )

        filtered_outdoor_pm = outside.pm25_ug_m3
        if state.ventilation.filter_enabled:
            filtered_outdoor_pm *= 1.0 - state.ventilation.filter_efficiency
        fan_makeup_flow = max(0.0, exhaust_flow - intake_flow)
        particle_inflow_ug_per_second = (
            natural_flow * outside.pm25_ug_m3
            + intake_flow * filtered_outdoor_pm
            + fan_makeup_flow * outside.pm25_ug_m3
        ) / (SECONDS_PER_HOUR * room_volume)
        particle_source_ug_per_second = (
            state.environment.pm25_generation_ug_min
            / (SECONDS_PER_MINUTE * room_volume)
        )
        particle_loss_rate_per_second = (
            exchange_rate_per_second
            + self._physics.pm25_deposition_rate_per_hour / SECONDS_PER_HOUR
        )
        pm25 = _integrate_mixed_concentration(
            old.pm25_ug_m3,
            0.0,
            particle_source_ug_per_second + particle_inflow_ug_per_second,
            particle_loss_rate_per_second,
            delta_seconds,
        )

        temperature = self._integrate_temperature(state, total_flow, delta_seconds)
        humidity = self._integrate_humidity(state, total_flow, temperature, delta_seconds)

        _require_finite("CO2", co2)
        _require_finite("PM2.5", pm25)
        _require_finite("temperature", temperature)
        _require_finite("relative humidity", humidity)
        state.indoor = AirQualityState(
            co2_ppm=max(0.0, co2),
            pm25_ug_m3=max(0.0, pm25),
            temperature_c=temperature,
            humidity_percent=humidity,
        )
        state.energy = self._advance_energy(state, total_flow, delta_seconds)

    def window_airflow_m3_h(self, state: SimulationState) -> float:
        physics = self._physics
        open_fraction = state.window.actual_position_percent / 100.0
        if open_fraction <= 0:
            return 0.0

        opening_fraction = open_fraction**physics.window_opening_exponent
        effective_area = (
            self._window_area_m2
            * physics.window_effective_area_factor
            * opening_fraction
        )
        inside_temperature = state.indoor.temperature_c
        outside_temperature = state.outdoor.temperature_c
        temperature_difference = abs(inside_temperature - outside_temperature)
        mean_temperature_kelvin = (
            (inside_temperature + outside_temperature) / 2.0 + CELSIUS_TO_KELVIN
        )
        wind_angle = math.radians(
            state.environment.wind_direction_degrees - physics.window_facade_normal_degrees
        )
        wind_incidence = abs(math.cos(wind_angle))
        wind_pressure = (
            0.5
            * physics.air_density_kg_m3
            * physics.wind_pressure_coefficient
            * state.environment.wind_speed_m_s**2
            * wind_incidence
        )
        stack_pressure = (
            physics.air_density_kg_m3
            * physics.gravity_m_s2
            * physics.window_stack_height_m
            * temperature_difference
            / (2.0 * mean_temperature_kelvin)
        )
        pressure_difference = wind_pressure + stack_pressure
        flow_m3_s = (
            physics.window_discharge_coefficient
            * effective_area
            * math.sqrt(2.0 * pressure_difference / physics.air_density_kg_m3)
        )
        return min(flow_m3_s * SECONDS_PER_HOUR, physics.window_max_airflow_m3_h)

    def _fan_airflow(self, fan: FanState) -> float:
        if not fan.enabled or fan.nominal_rpm <= 0:
            return 0.0
        speed_fraction = min(max(fan.rpm / fan.nominal_rpm, 0.0), 1.0)
        return fan.nominal_airflow_m3_h * speed_fraction**self._physics.fan_airflow_speed_exponent

    def _integrate_temperature(
        self,
        state: SimulationState,
        airflow_m3_h: float,
        delta_seconds: float,
    ) -> float:
        physics = self._physics
        ventilation_conductance = (
            physics.air_density_kg_m3
            * physics.air_specific_heat_j_kg_k
            * airflow_m3_h
            / SECONDS_PER_HOUR
        )
        total_conductance = physics.thermal_conductance_w_k + ventilation_conductance
        internal_heat_w = physics.sensible_heat_w_per_person * state.environment.occupancy
        equilibrium = state.outdoor.temperature_c + internal_heat_w / total_conductance
        attenuation = math.exp(
            -total_conductance * delta_seconds / physics.thermal_capacity_j_k
        )
        return min(
            max(
                equilibrium + (state.indoor.temperature_c - equilibrium) * attenuation,
                physics.minimum_room_temperature_c,
            ),
            physics.maximum_room_temperature_c,
        )

    def _integrate_humidity(
        self,
        state: SimulationState,
        airflow_m3_h: float,
        resulting_temperature_c: float,
        delta_seconds: float,
    ) -> float:
        physics = self._physics
        humidity_loss_rate = airflow_m3_h / (SECONDS_PER_HOUR * state.room_volume_m3)
        dry_air_mass_kg = physics.air_density_kg_m3 * state.room_volume_m3
        moisture_source_ratio_per_second = (
            physics.moisture_generation_kg_h_per_person
            * state.environment.occupancy
            / (SECONDS_PER_HOUR * dry_air_mass_kg)
        )
        current_ratio = self._humidity_ratio(
            state.indoor.humidity_percent, state.indoor.temperature_c
        )
        outside_ratio = self._humidity_ratio(
            state.outdoor.humidity_percent, state.outdoor.temperature_c
        )
        next_ratio = _integrate_mixed_concentration(
            current_ratio,
            outside_ratio,
            moisture_source_ratio_per_second,
            humidity_loss_rate,
            delta_seconds,
        )
        vapor_pressure = (
            next_ratio
            * physics.atmospheric_pressure_pa
            / (physics.humidity_ratio_constant + next_ratio)
        )
        relative_humidity = (
            100.0
            * vapor_pressure
            / self._saturation_pressure_pa(resulting_temperature_c)
        )
        return min(
            max(relative_humidity, physics.minimum_humidity_percent),
            physics.maximum_humidity_percent,
        )

    def _humidity_ratio(self, relative_humidity_percent: float, temperature_c: float) -> float:
        vapor_pressure = (
            relative_humidity_percent
            / 100.0
            * self._saturation_pressure_pa(temperature_c)
        )
        return (
            self._physics.humidity_ratio_constant
            * vapor_pressure
            / (self._physics.atmospheric_pressure_pa - vapor_pressure)
        )

    def _saturation_pressure_pa(self, temperature_c: float) -> float:
        physics = self._physics
        exponent = (
            physics.saturation_pressure_exponent
            * temperature_c
            / (temperature_c + physics.saturation_pressure_offset_c)
        )
        return physics.saturation_vapor_pressure_reference_pa * math.exp(exponent)

    def _advance_energy(
        self,
        state: SimulationState,
        airflow_m3_h: float,
        delta_seconds: float,
    ) -> EnergyState:
        fan_power_w = self._fan_electrical_power(state.ventilation.intake)
        fan_power_w += self._fan_electrical_power(state.ventilation.exhaust)
        fan_energy = state.energy.fan_energy_wh + fan_power_w * delta_seconds / JOULES_PER_WATT_HOUR

        temperature_difference = max(
            state.indoor.temperature_c - state.outdoor.temperature_c,
            0.0,
        )
        ventilation_heat_loss_w = (
            self._physics.air_density_kg_m3
            * self._physics.air_specific_heat_j_kg_k
            * airflow_m3_h
            / SECONDS_PER_HOUR
            * temperature_difference
        )
        heat_loss = (
            state.energy.estimated_ventilation_heat_loss_wh
            + ventilation_heat_loss_w * delta_seconds / JOULES_PER_WATT_HOUR
        )
        return EnergyState(
            fan_energy_wh=fan_energy,
            estimated_ventilation_heat_loss_wh=heat_loss,
            total_relative_energy=fan_energy + heat_loss,
        )

    def _fan_electrical_power(self, fan: FanState) -> float:
        if not fan.enabled or fan.nominal_rpm <= 0:
            return 0.0
        speed_fraction = min(max(fan.rpm / fan.nominal_rpm, 0.0), 1.0)
        shaft_power_w = fan.rated_power_w * speed_fraction**self._physics.fan_power_speed_exponent
        return shaft_power_w / fan.efficiency


def _integrate_mixed_concentration(
    current: float,
    outdoor: float,
    source_rate_per_second: float,
    loss_rate_per_second: float,
    delta_seconds: float,
) -> float:
    """Exact solution for dC/dt = source + loss * (outdoor - C)."""
    if loss_rate_per_second <= 0:
        return current + source_rate_per_second * delta_seconds
    attenuation = math.exp(-loss_rate_per_second * delta_seconds)
    equilibrium = outdoor + source_rate_per_second / loss_rate_per_second
    return equilibrium + (current - equilibrium) * attenuation


def _require_finite(name: str, value: float) -> None:
    if not math.isfinite(value):
        raise ArithmeticError(f"{name} model produced a non-finite value")
