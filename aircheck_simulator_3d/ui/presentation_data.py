from __future__ import annotations

from datetime import datetime, timezone

from aircheck_simulator_3d.devices.models import SensorDeviceState
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.scene.objects import SceneObject
from aircheck_simulator_3d.simulation.state import SimulationState
from aircheck_simulator_3d.simulation.virtual_sensors import SensorReadingUnavailable, read_sensor_value


SENSOR_OBJECT_IDS = {
    "sensor.scd41.indoor": "indoor_climate",
    "sensor.sps30.indoor": "indoor_particles",
    "sensor.sht45.outdoor": "outdoor_climate",
    "sensor.sps30.outdoor": "outdoor_particles",
}


def format_hud(
    state: SimulationState,
    forecast: BackendForecast | None,
    backend_online: bool,
    scenario_name: str,
    demo_phase: str,
) -> str:
    indoor = _zone_summary(state, "indoor")
    outdoor = _zone_summary(state, "outdoor")
    window = state.window
    intake = state.ventilation.intake
    exhaust = state.ventilation.exhaust
    forecast_value = (
        f"{forecast.predicted_co2_15min:.0f} ppm"
        if forecast is not None
        else "ожидается backend"
    )
    sim = "PAUSE" if state.simulation_speed == 0 else f"{state.simulation_speed:g}×"
    return (
        f"AIR  /  {scenario_name.upper()}\n"
        f"INDOOR  CO2 {indoor['co2']}   PM2.5 {indoor['pm25']}\n"
        f"         {indoor['temperature']}   RH {indoor['humidity']}\n"
        f"OUTDOOR PM2.5 {outdoor['pm25']}   {outdoor['temperature']}   RH {outdoor['humidity']}\n"
        f"WINDOW {window.motor_state.value.upper()} {window.actual_position_percent:.0f}%  ·  "
        f"IN { _on_off(intake.enabled) } {intake.airflow_m3_h:.0f} m³/h  ·  "
        f"OUT { _on_off(exhaust.enabled) } {exhaust.airflow_m3_h:.0f} m³/h\n"
        f"CO2 +15 min  {forecast_value}  ·  { 'ONLINE' if backend_online else 'OFFLINE' }  ·  {sim}\n"
        f"DEMO  {demo_phase}"
    )


def device_details(
    selected: SceneObject | None,
    state: SimulationState,
    *,
    backend_online: bool,
    backend_message: str | None,
    last_telemetry_at: str | None,
    pending_commands: int,
) -> tuple[str, str]:
    if selected is None:
        return "DEVICE DETAILS", "Выберите устройство ЛКМ — показания и состояние будут обновляться в реальном времени."

    object_id = selected.object_id
    title = selected.title
    description = selected.description
    sensor_id = SENSOR_OBJECT_IDS.get(object_id)
    if sensor_id:
        sensor = _find_sensor(state, sensor_id)
        if sensor is None:
            return title, f"{description}\n\nДатчик не найден в Device Layer."
        return title, _sensor_details(sensor, state)
    if object_id == "device.esp32":
        last = _age_label(last_telemetry_at)
        link = "ONLINE" if backend_online else "OFFLINE"
        if backend_message:
            link += f" · {backend_message}"
        return title, (
            f"Virtual ESP32 · {state.controller.device_id}\n"
            "Wi-Fi: эмулируется сетевым подключением приложения\n"
            f"AirCheck backend: {link}\n"
            f"Last telemetry: {last}\n"
            f"Commands executing: {pending_commands}\n"
            f"Sensors online: {sum(item.online for item in state.sensors)}/{len(state.sensors)}"
        )
    if object_id in {"window.assembly", "window.actuator", "window.reed_switch", "window.magnet", "window.limit_open", "window.limit_close"}:
        window = state.window
        detail = (
            f"Actuator: {window.motor_state.value.upper()}\n"
            f"Target / actual: {window.target_position_percent:.0f}% / {window.actual_position_percent:.0f}%\n"
            f"Reed switch: {'OPEN' if window.reed_switch else 'CLOSED'}\n"
            f"Open limit: {_on_off(window.open_limit_switch)}\n"
            f"Close limit: {_on_off(window.close_limit_switch)}"
        )
        return title, f"{description}\n\n{detail}"
    if object_id in {"fan.intake", "fan.exhaust"}:
        intake_side = object_id == "fan.intake"
        fan = state.ventilation.intake if intake_side else state.ventilation.exhaust
        flow_path = "OUTSIDE → FILTER → ROOM" if intake_side else "ROOM → OUTSIDE"
        filter_status = (
            f"Filter: {'ON' if state.ventilation.filter_enabled else 'OFF'} · "
            f"efficiency {state.ventilation.filter_efficiency * 100:.0f}%\n"
            if intake_side
            else ""
        )
        return title, (
            f"{description}\n\nState: {_on_off(fan.enabled)}\n"
            f"Airflow: {fan.airflow_m3_h:.1f} m³/h\nRPM: {fan.rpm:.0f}\n"
            f"Path: {flow_path}\n{filter_status}"
        )
    if object_id.startswith("power."):
        return title, f"{description}\n\nВиртуальный узел: установлен. Состояние отображается схемой стенда; силовая модель не рассчитывается."
    return title, f"{description}\n\nУзел сцены: {object_id}"


def _sensor_details(sensor: SensorDeviceState, state: SimulationState) -> str:
    if not sensor.online:
        return (
            f"Type: {sensor.model}\nInterface: {sensor.interface}\n"
            f"Node: {sensor.zone.upper()}\nStatus: OFFLINE · нет достоверных показаний\n"
            "Telemetry для AirCheck приостановлена до восстановления всех виртуальных датчиков."
        )
    values = []
    for measurement in sensor.measurements:
        label, unit = {
            "co2": ("CO2", "ppm"),
            "pm25": ("PM2.5", "µg/m³"),
            "temperature": ("Temperature", "°C"),
            "humidity": ("Humidity", "%"),
        }.get(measurement, (measurement, ""))
        try:
            value = read_sensor_value(state, sensor.zone, measurement)
        except SensorReadingUnavailable:
            formatted = "NO SIGNAL"
        else:
            formatted = f"{value:.1f} {unit}".rstrip()
        values.append(f"{label}: {formatted}")
    extra = "\nPM1.0 / PM4 / PM10: not modeled in this room model" if sensor.model.endswith("SPS30") else ""
    return (
        f"Type: {sensor.model}\nInterface: {sensor.interface}\nNode: {sensor.zone.upper()}\n"
        f"Status: ONLINE\nCurrent values:\n" + "\n".join(values) + extra
    )


def _zone_summary(state: SimulationState, zone: str) -> dict[str, str]:
    readings: dict[str, str] = {}
    fields = ("co2", "pm25", "temperature", "humidity") if zone == "indoor" else (
        "pm25", "temperature", "humidity"
    )
    for measurement in fields:
        try:
            value = read_sensor_value(state, zone, measurement)
        except SensorReadingUnavailable:
            readings[measurement] = "—"
            continue
        if measurement == "co2":
            readings[measurement] = f"{value:.0f} ppm"
        elif measurement == "pm25":
            readings[measurement] = f"{value:.1f}"
        elif measurement == "temperature":
            readings[measurement] = f"{value:.1f}°C"
        else:
            readings[measurement] = f"{value:.0f}%"
    return readings


def _find_sensor(state: SimulationState, sensor_id: str) -> SensorDeviceState | None:
    return next((sensor for sensor in state.sensors if sensor.sensor_id == sensor_id), None)


def _on_off(value: bool) -> str:
    return "ON" if value else "OFF"


def _age_label(timestamp: str | None) -> str:
    if not timestamp:
        return "no successful telemetry yet"
    try:
        sent_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return "timestamp unavailable"
    age = max(0.0, (datetime.now(timezone.utc) - sent_at).total_seconds())
    if age < 10:
        return f"{age:.1f} s ago"
    if age < 60:
        return f"{age:.0f} s ago"
    return f"{age / 60:.1f} min ago"
