from __future__ import annotations

import math
import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_DIR = PACKAGE_ROOT / "config"


class ConfigurationError(ValueError):
    """Raised when simulator configuration is absent or invalid."""


@dataclass(frozen=True)
class AirReadingConfig:
    co2_ppm: float
    pm25_ug_m3: float
    temperature_c: float
    humidity_percent: float


@dataclass(frozen=True)
class RoomConfig:
    volume_m3: float
    simulation_speed: float
    initial_indoor: AirReadingConfig
    initial_outdoor: AirReadingConfig
    occupancy: int
    co2_generation_l_min: float
    pm25_generation_ug_min: float
    infiltration_ach: float
    weather: str
    wind_speed_m_s: float
    wind_direction_degrees: float


@dataclass(frozen=True)
class SensorConfig:
    sensor_id: str
    model: str
    zone: str
    measurements: tuple[str, ...]


@dataclass(frozen=True)
class DeviceConfig:
    device_id: str
    sensors: tuple[SensorConfig, ...]
    initial_window_position_percent: float
    window_travel_seconds: float
    intake_nominal_rpm: float
    exhaust_nominal_rpm: float
    intake_airflow_m3_h: float
    exhaust_airflow_m3_h: float
    filter_efficiency: float
    intake_power_w: float
    exhaust_power_w: float
    window_reed_open_threshold_percent: float


@dataclass(frozen=True)
class PhysicsConfig:
    fixed_step_seconds: float
    max_substeps_per_frame: int


@dataclass(frozen=True)
class BackendConfig:
    backend_url: str
    dashboard_url: str
    telemetry_interval_seconds: float
    request_timeout_seconds: float
    retry_attempts: int
    retry_base_delay_seconds: float
    command_limit: int

    @property
    def resolved_dashboard_url(self) -> str:
        return self.dashboard_url or self.backend_url


@dataclass(frozen=True)
class GraphicsConfig:
    window_title: str
    width: int
    height: int
    fullscreen: bool
    background_rgb: tuple[float, float, float]
    text_rgb: tuple[float, float, float]
    text_scale: float


@dataclass(frozen=True)
class LoggingConfig:
    directory: Path
    level: str
    max_bytes: int
    backup_count: int


@dataclass(frozen=True)
class AppConfig:
    room: RoomConfig
    devices: DeviceConfig
    physics: PhysicsConfig
    backend: BackendConfig
    graphics: GraphicsConfig
    logging: LoggingConfig


def _read_toml(path: Path) -> dict[str, object]:
    try:
        with path.open("rb") as stream:
            value = tomllib.load(stream)
    except OSError as exc:
        raise ConfigurationError(f"cannot read configuration file {path}: {exc}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigurationError(f"invalid TOML in {path}: {exc}") from exc
    return value


def _section(raw: dict[str, object], name: str, path: Path) -> dict[str, object]:
    value = raw.get(name)
    if not isinstance(value, dict):
        raise ConfigurationError(f"{path.name} must contain a [{name}] table")
    return value


def _number(section: dict[str, object], key: str, source: str) -> float:
    value = section.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigurationError(f"{source}: {key} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ConfigurationError(f"{source}: {key} must be finite")
    return result


def _integer(section: dict[str, object], key: str, source: str) -> int:
    value = section.get(key)
    if type(value) is not int:
        raise ConfigurationError(f"{source}: {key} must be an integer")
    return value


def _text(section: dict[str, object], key: str, source: str) -> str:
    value = section.get(key)
    if not isinstance(value, str):
        raise ConfigurationError(f"{source}: {key} must be a string")
    return value.strip()


def _boolean(section: dict[str, object], key: str, source: str) -> bool:
    value = section.get(key)
    if not isinstance(value, bool):
        raise ConfigurationError(f"{source}: {key} must be a boolean")
    return value


def _color(section: dict[str, object], key: str, source: str) -> tuple[float, float, float]:
    value = section.get(key)
    if not isinstance(value, list) or len(value) != 3:
        raise ConfigurationError(f"{source}: {key} must contain three color components")
    components = tuple(float(component) for component in value if isinstance(component, (int, float)))
    if len(components) != 3 or any(
        not math.isfinite(component) or not 0 <= component <= 1 for component in components
    ):
        raise ConfigurationError(f"{source}: {key} components must be between 0 and 1")
    return components


def _air_reading(section: dict[str, object], source: str) -> AirReadingConfig:
    values = AirReadingConfig(
        co2_ppm=_number(section, "co2_ppm", source),
        pm25_ug_m3=_number(section, "pm25_ug_m3", source),
        temperature_c=_number(section, "temperature_c", source),
        humidity_percent=_number(section, "humidity_percent", source),
    )
    if values.co2_ppm <= 0 or values.pm25_ug_m3 < 0 or not 0 <= values.humidity_percent <= 100:
        raise ConfigurationError(f"{source}: initial air readings are outside valid ranges")
    return values


def _sensor_configs(section: dict[str, object], source: str) -> tuple[SensorConfig, ...]:
    sensors: list[SensorConfig] = []
    for sensor_id, value in sorted(section.items()):
        if not isinstance(value, dict):
            raise ConfigurationError(f"{source}: {sensor_id} must be a table")
        measurements = value.get("measurements")
        if not isinstance(measurements, list) or not measurements or not all(
            isinstance(item, str) and item.strip() for item in measurements
        ):
            raise ConfigurationError(f"{source}: {sensor_id}.measurements must be a non-empty list of strings")
        sensors.append(
            SensorConfig(
                sensor_id=sensor_id,
                model=_text(value, "model", source),
                zone=_text(value, "zone", source),
                measurements=tuple(item.strip() for item in measurements),
            )
        )
    return tuple(sensors)


def _environment_float(environ: Mapping[str, str], name: str, default: float) -> float:
    try:
        value = float(environ[name]) if name in environ else default
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number") from exc
    if not math.isfinite(value):
        raise ConfigurationError(f"{name} must be finite")
    return value


def _environment_integer(environ: Mapping[str, str], name: str, default: int) -> int:
    try:
        return int(environ[name]) if name in environ else default
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc


def _apply_environment_overrides(
    backend: BackendConfig,
    devices: DeviceConfig,
    room: RoomConfig,
    logging_config: LoggingConfig,
    environ: Mapping[str, str],
) -> tuple[BackendConfig, DeviceConfig, RoomConfig, LoggingConfig]:
    backend_url = environ.get("BACKEND_URL", backend.backend_url).strip().rstrip("/")
    dashboard_url = environ.get("DASHBOARD_URL", backend.dashboard_url).strip().rstrip("/")
    device_id = environ.get("DEVICE_ID", devices.device_id).strip()
    updated_backend = BackendConfig(
        backend_url=backend_url,
        dashboard_url=dashboard_url,
        telemetry_interval_seconds=_environment_float(
            environ, "SIMULATOR_INTERVAL_SECONDS", backend.telemetry_interval_seconds
        ),
        request_timeout_seconds=_environment_float(
            environ, "REQUEST_TIMEOUT_SECONDS", backend.request_timeout_seconds
        ),
        retry_attempts=_environment_integer(environ, "RETRY_ATTEMPTS", backend.retry_attempts),
        retry_base_delay_seconds=_environment_float(
            environ, "RETRY_BASE_DELAY_SECONDS", backend.retry_base_delay_seconds
        ),
        command_limit=backend.command_limit,
    )
    indoor = AirReadingConfig(
        co2_ppm=_environment_float(environ, "INITIAL_CO2", room.initial_indoor.co2_ppm),
        pm25_ug_m3=room.initial_indoor.pm25_ug_m3,
        temperature_c=_environment_float(environ, "BASE_TEMPERATURE", room.initial_indoor.temperature_c),
        humidity_percent=_environment_float(environ, "BASE_HUMIDITY", room.initial_indoor.humidity_percent),
    )
    updated_room = RoomConfig(**{**room.__dict__, "initial_indoor": indoor})
    updated_devices = DeviceConfig(**{**devices.__dict__, "device_id": device_id})
    updated_logging = LoggingConfig(
        **{**logging_config.__dict__, "level": environ.get("LOG_LEVEL", logging_config.level).strip().upper()}
    )
    return updated_backend, updated_devices, updated_room, updated_logging


def _validate(config: AppConfig) -> None:
    if not config.devices.device_id:
        raise ConfigurationError("device_id must not be empty")
    if not config.devices.sensors:
        raise ConfigurationError("at least one sensor must be configured")
    sensor_ids = [sensor.sensor_id for sensor in config.devices.sensors]
    if len(set(sensor_ids)) != len(sensor_ids):
        raise ConfigurationError("sensor identifiers must be unique")
    if any(
        not sensor.model or sensor.zone not in {"indoor", "window", "outdoor"}
        for sensor in config.devices.sensors
    ):
        raise ConfigurationError("sensor model or placement zone is invalid")
    urls = (
        ("backend_url", config.backend.backend_url),
        ("dashboard_url", config.backend.resolved_dashboard_url),
    )
    for field, url in urls:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigurationError(f"{field} must be an absolute HTTP(S) URL")
    if config.room.volume_m3 <= 0 or config.room.simulation_speed <= 0:
        raise ConfigurationError("room volume and simulation speed must be positive")
    if config.room.occupancy < 0 or config.room.co2_generation_l_min < 0 or config.room.pm25_generation_ug_min < 0:
        raise ConfigurationError("occupancy and generation rates cannot be negative")
    for zone, reading in (("indoor", config.room.initial_indoor), ("outdoor", config.room.initial_outdoor)):
        temperature_min = -60 if zone == "outdoor" else -40
        co2_valid = reading.co2_ppm > 0 if zone == "outdoor" else 250 <= reading.co2_ppm <= 10000
        if (
            not co2_valid
            or not 0 <= reading.pm25_ug_m3 <= 1000
            or not temperature_min <= reading.temperature_c <= 80
            or not 0 <= reading.humidity_percent <= 100
        ):
            raise ConfigurationError(f"{zone} initial readings are outside the AirCheck measurement ranges")
    if (
        config.devices.window_travel_seconds <= 0
        or config.devices.intake_nominal_rpm < 0
        or config.devices.exhaust_nominal_rpm < 0
    ):
        raise ConfigurationError("device travel time must be positive and fan RPM cannot be negative")
    if min(
        config.devices.intake_airflow_m3_h,
        config.devices.exhaust_airflow_m3_h,
        config.devices.intake_power_w,
        config.devices.exhaust_power_w,
    ) < 0:
        raise ConfigurationError("fan airflow and power cannot be negative")
    if config.room.infiltration_ach < 0 or config.room.wind_speed_m_s < 0:
        raise ConfigurationError("infiltration and wind speed cannot be negative")
    if config.physics.fixed_step_seconds <= 0 or config.physics.max_substeps_per_frame < 1:
        raise ConfigurationError("physics step and maximum substeps must be positive")
    if not 0 <= config.devices.initial_window_position_percent <= 100:
        raise ConfigurationError("initial window position must be between 0 and 100")
    if not 0 <= config.devices.filter_efficiency <= 1:
        raise ConfigurationError("filter efficiency must be between 0 and 1")
    if not 0 <= config.devices.window_reed_open_threshold_percent <= 100:
        raise ConfigurationError("reed switch threshold must be between 0 and 100")
    if config.backend.telemetry_interval_seconds <= 0 or config.backend.request_timeout_seconds <= 0:
        raise ConfigurationError("telemetry interval and request timeout must be positive")
    if (
        config.backend.retry_attempts < 1
        or config.backend.retry_base_delay_seconds < 0
        or config.backend.command_limit < 1
    ):
        raise ConfigurationError("backend retries, retry delay or command limit is invalid")
    if config.graphics.width < 1 or config.graphics.height < 1 or config.graphics.text_scale <= 0:
        raise ConfigurationError("graphics dimensions and text scale must be positive")
    if config.logging.level.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ConfigurationError("logging level is not a standard Python log level")
    if config.logging.max_bytes < 1 or config.logging.backup_count < 0:
        raise ConfigurationError("logging rotation settings are invalid")


def load_config(
    config_dir: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> AppConfig:
    directory = (config_dir or DEFAULT_CONFIG_DIR).expanduser().resolve()
    config_names = ("room", "devices", "physics", "backend", "graphics", "logging")
    paths = {name: directory / f"{name}.toml" for name in config_names}
    raw = {name: _read_toml(path) for name, path in paths.items()}

    room_table = _section(raw["room"], "room", paths["room"])
    environment_table = _section(raw["room"], "environment", paths["room"])
    devices_table = _section(raw["devices"], "devices", paths["devices"])
    sensors_table = _section(raw["devices"], "sensors", paths["devices"])
    window_table = _section(raw["devices"], "window", paths["devices"])
    ventilation_table = _section(raw["devices"], "ventilation", paths["devices"])
    physics_table = _section(raw["physics"], "physics", paths["physics"])
    backend_table = _section(raw["backend"], "backend", paths["backend"])
    graphics_table = _section(raw["graphics"], "graphics", paths["graphics"])
    logging_table = _section(raw["logging"], "logging", paths["logging"])
    indoor_table = _section(raw["room"], "initial_indoor", paths["room"])
    outdoor_table = _section(raw["room"], "initial_outdoor", paths["room"])

    try:
        room = RoomConfig(
            volume_m3=_number(room_table, "volume_m3", "room.toml [room]"),
            simulation_speed=_number(room_table, "simulation_speed", "room.toml [room]"),
            initial_indoor=_air_reading(indoor_table, "room.toml [initial_indoor]"),
            initial_outdoor=_air_reading(outdoor_table, "room.toml [initial_outdoor]"),
            occupancy=_integer(environment_table, "occupancy", "room.toml [environment]"),
            co2_generation_l_min=_number(environment_table, "co2_generation_l_min", "room.toml [environment]"),
            pm25_generation_ug_min=_number(environment_table, "pm25_generation_ug_min", "room.toml [environment]"),
            infiltration_ach=_number(environment_table, "infiltration_ach", "room.toml [environment]"),
            weather=_text(environment_table, "weather", "room.toml [environment]"),
            wind_speed_m_s=_number(environment_table, "wind_speed_m_s", "room.toml [environment]"),
            wind_direction_degrees=_number(environment_table, "wind_direction_degrees", "room.toml [environment]"),
        )
        devices = DeviceConfig(
            device_id=_text(devices_table, "device_id", "devices.toml [devices]"),
            sensors=_sensor_configs(sensors_table, "devices.toml [sensors]"),
            initial_window_position_percent=_number(window_table, "initial_position_percent", "devices.toml [window]"),
            window_travel_seconds=_number(window_table, "travel_seconds", "devices.toml [window]"),
            window_reed_open_threshold_percent=_number(
                window_table, "reed_open_threshold_percent", "devices.toml [window]"
            ),
            intake_nominal_rpm=_number(ventilation_table, "intake_nominal_rpm", "devices.toml [ventilation]"),
            exhaust_nominal_rpm=_number(ventilation_table, "exhaust_nominal_rpm", "devices.toml [ventilation]"),
            intake_airflow_m3_h=_number(ventilation_table, "intake_airflow_m3_h", "devices.toml [ventilation]"),
            exhaust_airflow_m3_h=_number(ventilation_table, "exhaust_airflow_m3_h", "devices.toml [ventilation]"),
            filter_efficiency=_number(ventilation_table, "filter_efficiency", "devices.toml [ventilation]"),
            intake_power_w=_number(ventilation_table, "intake_power_w", "devices.toml [ventilation]"),
            exhaust_power_w=_number(ventilation_table, "exhaust_power_w", "devices.toml [ventilation]"),
        )
        physics = PhysicsConfig(
            fixed_step_seconds=_number(physics_table, "fixed_step_seconds", "physics.toml [physics]"),
            max_substeps_per_frame=_integer(physics_table, "max_substeps_per_frame", "physics.toml [physics]"),
        )
        backend = BackendConfig(
            backend_url=_text(backend_table, "backend_url", "backend.toml [backend]").rstrip("/"),
            dashboard_url=_text(backend_table, "dashboard_url", "backend.toml [backend]").rstrip("/"),
            telemetry_interval_seconds=_number(backend_table, "telemetry_interval_seconds", "backend.toml [backend]"),
            request_timeout_seconds=_number(backend_table, "request_timeout_seconds", "backend.toml [backend]"),
            retry_attempts=_integer(backend_table, "retry_attempts", "backend.toml [backend]"),
            retry_base_delay_seconds=_number(backend_table, "retry_base_delay_seconds", "backend.toml [backend]"),
            command_limit=_integer(backend_table, "command_limit", "backend.toml [backend]"),
        )
        graphics = GraphicsConfig(
            window_title=_text(graphics_table, "window_title", "graphics.toml [graphics]"),
            width=_integer(graphics_table, "width", "graphics.toml [graphics]"),
            height=_integer(graphics_table, "height", "graphics.toml [graphics]"),
            fullscreen=_boolean(graphics_table, "fullscreen", "graphics.toml [graphics]"),
            background_rgb=_color(graphics_table, "background_rgb", "graphics.toml [graphics]"),
            text_rgb=_color(graphics_table, "text_rgb", "graphics.toml [graphics]"),
            text_scale=_number(graphics_table, "text_scale", "graphics.toml [graphics]"),
        )
        log_directory = Path(_text(logging_table, "directory", "logging.toml [logging]"))
        if not log_directory.is_absolute():
            log_directory = directory.parent / log_directory
        logging_config = LoggingConfig(
            directory=log_directory,
            level=_text(logging_table, "level", "logging.toml [logging]"),
            max_bytes=_integer(logging_table, "max_bytes", "logging.toml [logging]"),
            backup_count=_integer(logging_table, "backup_count", "logging.toml [logging]"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, ConfigurationError):
            raise
        raise ConfigurationError(f"invalid simulator configuration: {exc}") from exc

    backend, devices, room, logging_config = _apply_environment_overrides(
        backend, devices, room, logging_config, environ if environ is not None else os.environ
    )
    config = AppConfig(
        room=room,
        devices=devices,
        physics=physics,
        backend=backend,
        graphics=graphics,
        logging=logging_config,
    )
    _validate(config)
    return config
