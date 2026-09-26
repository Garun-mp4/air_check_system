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

SCENARIO_LABELS_RU = {
    "Normal Room": "Обычная комната",
    "CO2 Buildup": "Рост CO₂",
    "High Occupancy": "Много людей",
    "Clean Outdoor Air": "Чистый наружный воздух",
    "Polluted Outdoor Air": "Загрязнённый наружный воздух",
    "Cold Weather": "Холодная погода",
    "High Indoor PM2.5": "Повышенный PM2.5",
    "Sensor Failure": "Отказ датчика",
    "Backend Offline": "Backend недоступен",
    "Automatic demo": "Автодемонстрация",
}

DEMO_PHASES_RU = {
    "READY": "ГОТОВО",
    "CO2 BUILD-UP": "РОСТ CO₂",
    "BACKEND ML FORECAST": "ПРОГНОЗ BACKEND",
    "BACKEND COMMAND": "КОМАНДА BACKEND",
    "ACTUATOR EXECUTION": "РАБОТА ПРИВОДА",
    "WAITING FOR ACK": "ОЖИДАЕТСЯ ACK",
    "ACKNOWLEDGED · OBSERVING AIR": "ACK ПОЛУЧЕН · НАБЛЮДЕНИЕ",
    "DEMO COMPLETE": "ДЕМОНСТРАЦИЯ ЗАВЕРШЕНА",
    "WAITING FOR BACKEND FORECAST": "ОЖИДАЕТСЯ ПРОГНОЗ",
}


def format_hud(
    state: SimulationState,
    forecast: BackendForecast | None,
    backend_online: bool,
    scenario_name: str,
    demo_phase: str,
) -> str:
    data = hud_data(state, forecast, backend_online, scenario_name, demo_phase)
    return (
        f"ВОЗДУХ  /  {data['scenario'].upper()}\n"
        f"В ПОМЕЩЕНИИ  CO₂ {data['co2']}   PM2.5 {data['pm25']}\n"
        f"ТЕМПЕРАТУРА {data['temperature']}   ВЛАЖНОСТЬ {data['humidity']}\n"
        f"СНАРУЖИ  PM2.5 {data['outdoor_pm25']}   {data['outdoor_temperature']}   ВЛАЖНОСТЬ {data['outdoor_humidity']}\n"
        f"ОКНО {data['window']}  ·  ПРИТОК {data['intake']}  ·  ВЫТЯЖКА {data['exhaust']}\n"
        f"ПРОГНОЗ +15 МИН {data['forecast']}  ·  СВЯЗЬ {data['backend']}  ·  {data['speed']}\n"
        f"ДЕМО  {data['demo']}"
    )


def hud_data(
    state: SimulationState,
    forecast: BackendForecast | None,
    backend_online: bool,
    scenario_name: str,
    demo_phase: str,
) -> dict[str, str]:
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
    return {
        "scenario": SCENARIO_LABELS_RU.get(scenario_name, scenario_name),
        "co2": indoor["co2"],
        "pm25": f"{indoor['pm25']} мкг/м³",
        "temperature": indoor["temperature"],
        "humidity": indoor["humidity"],
        "outdoor_pm25": f"{outdoor['pm25']} мкг/м³",
        "outdoor_temperature": outdoor["temperature"],
        "outdoor_humidity": outdoor["humidity"],
        "window": f"{_window_state(window.motor_state.value)} · {window.actual_position_percent:.0f}%",
        "intake": f"{_on_off(intake.enabled)} · {intake.airflow_m3_h:.0f} м³/ч",
        "exhaust": f"{_on_off(exhaust.enabled)} · {exhaust.airflow_m3_h:.0f} м³/ч",
        "forecast": forecast_value,
        "backend": "В СЕТИ" if backend_online else "НЕТ СВЯЗИ",
        "speed": "ПАУЗА" if state.simulation_speed == 0 else f"{state.simulation_speed:g}×",
        "demo": DEMO_PHASES_RU.get(demo_phase, demo_phase),
    }


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
        return "ВЫБЕРИТЕ УЗЕЛ", "Выберите оборудование на стенде — здесь появятся его состояние и текущие показания."

    object_id = selected.object_id
    title = selected.title
    description = selected.description
    sensor_id = SENSOR_OBJECT_IDS.get(object_id)
    if sensor_id:
        sensor = _find_sensor(state, sensor_id)
        if sensor is None:
            return title, f"{description}\n\nДатчик не найден в слое устройств."
        return title, _sensor_details(sensor, state)
    if object_id == "device.esp32":
        last = _age_label(last_telemetry_at)
        link = "В СЕТИ" if backend_online else "НЕТ СВЯЗИ"
        if backend_message:
            link += f" · {backend_message}"
        return title, (
            f"Виртуальный ESP32 · {state.controller.device_id}\n"
            "Wi-Fi: связь эмулируется сетевым подключением приложения\n"
            f"Сервер AirCheck: {link}\n"
            f"Последняя телеметрия: {last}\n"
            f"Команд выполняется: {pending_commands}\n"
            f"Датчики в сети: {sum(item.online for item in state.sensors)}/{len(state.sensors)}"
        )
    if object_id in {"window.assembly", "window.actuator", "window.reed_switch", "window.magnet", "window.limit_open", "window.limit_close"}:
        window = state.window
        detail = (
            f"Привод: {_window_state(window.motor_state.value)}\n"
            f"Задано / фактически: {window.target_position_percent:.0f}% / {window.actual_position_percent:.0f}%\n"
            f"Геркон: {'ОТКРЫТО' if window.reed_switch else 'ЗАКРЫТО'}\n"
            f"Концевик открытия: {_on_off(window.open_limit_switch)}\n"
            f"Концевик закрытия: {_on_off(window.close_limit_switch)}"
        )
        return title, f"{description}\n\n{detail}"
    if object_id in {"fan.intake", "fan.exhaust"}:
        intake_side = object_id == "fan.intake"
        fan = state.ventilation.intake if intake_side else state.ventilation.exhaust
        flow_path = "УЛИЦА → ФИЛЬТР → КОМНАТА" if intake_side else "КОМНАТА → УЛИЦА"
        filter_status = (
            f"Фильтр: {'ВКЛ' if state.ventilation.filter_enabled else 'ВЫКЛ'} · "
            f"эффективность {state.ventilation.filter_efficiency * 100:.0f}%\n"
            if intake_side
            else ""
        )
        return title, (
            f"{description}\n\nСостояние: {_on_off(fan.enabled)}\n"
            f"Расход воздуха: {fan.airflow_m3_h:.1f} м³/ч\nОбороты: {fan.rpm:.0f} об/мин\n"
            f"Направление потока: {flow_path}\n{filter_status}"
        )
    if object_id.startswith("power."):
        return title, f"{description}\n\nСиловой узел стенда. Его состояние показано схемой; электрический режим не рассчитывается."
    return title, f"{description}\n\nУзел сцены: {object_id}"


def _sensor_details(sensor: SensorDeviceState, state: SimulationState) -> str:
    if not sensor.online:
        return (
            f"Модель: {sensor.model}\nИнтерфейс: {sensor.interface}\n"
            f"Узел: { _zone_label(sensor.zone) }\nСостояние: НЕТ СВЯЗИ · показания недостоверны\n"
            "Передача телеметрии приостановлена до восстановления датчика."
        )
    values = []
    for measurement in sensor.measurements:
        label, unit = {
            "co2": ("CO₂", "ppm"),
            "pm25": ("PM2.5", "мкг/м³"),
            "temperature": ("Температура", "°C"),
            "humidity": ("Влажность", "%"),
        }.get(measurement, (measurement, ""))
        try:
            value = read_sensor_value(state, sensor.zone, measurement)
        except SensorReadingUnavailable:
            formatted = "НЕТ СИГНАЛА"
        else:
            formatted = f"{value:.1f} {unit}".rstrip()
        values.append(f"{label}: {formatted}")
    extra = "\nPM1.0 / PM4 / PM10: в модели помещения не рассчитываются" if sensor.model.endswith("SPS30") else ""
    return (
        f"Модель: {sensor.model}\nИнтерфейс: {sensor.interface}\nУзел: {_zone_label(sensor.zone)}\n"
        f"Состояние: В СЕТИ\nТекущие показания:\n" + "\n".join(values) + extra
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
    return "ВКЛ" if value else "ВЫКЛ"


def _zone_label(zone: str) -> str:
    return "ВНУТРЕННИЙ" if zone == "indoor" else "НАРУЖНЫЙ"


def _window_state(state: str) -> str:
    return {
        "opening": "ОТКРЫВАЕТСЯ",
        "closing": "ЗАКРЫВАЕТСЯ",
        "stopped": "ОСТАНОВЛЕНО",
        "open": "ОТКРЫТО",
        "closed": "ЗАКРЫТО",
    }.get(state.lower(), state.upper())


def _age_label(timestamp: str | None) -> str:
    if not timestamp:
        return "ещё не отправлялась"
    try:
        sent_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return "время недоступно"
    age = max(0.0, (datetime.now(timezone.utc) - sent_at).total_seconds())
    if age < 10:
        return f"{age:.1f} с назад"
    if age < 60:
        return f"{age:.0f} с назад"
    return f"{age / 60:.1f} мин назад"
