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
    ui_font_path: str
    multisample_enabled: bool
    multisamples: int
    shadows_enabled: bool
    shadow_map_size: int
    ambient_rgb: tuple[float, float, float]
    sun_rgb: tuple[float, float, float]


@dataclass(frozen=True)
class SceneConfig:
    room_width_m: float
    room_depth_m: float
    room_height_m: float
    wall_thickness_m: float
    platform_margin_m: float
    window_width_m: float
    window_height_m: float
    window_sill_height_m: float
    outdoor_depth_m: float
    window_open_angle_degrees: float


@dataclass(frozen=True)
class CameraConfig:
    start_position: tuple[float, float, float]
    start_target: tuple[float, float, float]
    move_speed_m_s: float
    fast_move_multiplier: float
    acceleration: float
    mouse_sensitivity: float
    wheel_step_m: float
    transition_seconds: float
    min_pitch_degrees: float
    max_pitch_degrees: float
    field_of_view_degrees: float
    near_plane_m: float
    far_plane_m: float
    focus_distance_min_m: float


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
    scene: SceneConfig
    camera: CameraConfig
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
    components = tuple(
        float(component)
        for component in value
        if isinstance(component, (int, float)) and not isinstance(component, bool)
    )
    if len(components) != 3 or any(
        not math.isfinite(component) or not 0 <= component <= 1 for component in components
    ):
        raise ConfigurationError(f"{source}: {key} components must be between 0 and 1")
    return components


def _vector3(section: dict[str, object], key: str, source: str) -> tuple[float, float, float]:
    value = section.get(key)
    if not isinstance(value, list) or len(value) != 3:
        raise ConfigurationError(f"{source}: {key} must contain three numbers")
    components = tuple(
        float(component)
        for component in value
        if isinstance(component, (int, float)) and not isinstance(component, bool)
    )
    if len(components) != 3 or any(not math.isfinite(component) for component in components):
        raise ConfigurationError(f"{source}: {key} must contain three finite numbers")
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
    if not config.graphics.ui_font_path:
        raise ConfigurationError("graphics.ui_font_path must not be empty")
    if config.graphics.multisamples < 0 or config.graphics.shadow_map_size < 0:
        raise ConfigurationError("multisample count and shadow map size cannot be negative")
    if config.graphics.multisample_enabled and config.graphics.multisamples < 2:
        raise ConfigurationError("multisamples must be at least 2 when multisampling is enabled")
    if config.graphics.shadows_enabled and config.graphics.shadow_map_size < 128:
        raise ConfigurationError("shadow map size must be at least 128 when shadows are enabled")
    scene = config.scene
    if min(scene.room_width_m, scene.room_depth_m, scene.room_height_m, scene.wall_thickness_m) <= 0:
        raise ConfigurationError("room dimensions and wall thickness must be positive")
    if min(scene.platform_margin_m, scene.outdoor_depth_m) < 0:
        raise ConfigurationError("platform margin and outdoor depth cannot be negative")
    if not 0 < scene.window_width_m < scene.room_width_m or not 0 < scene.window_height_m < scene.room_height_m:
        raise ConfigurationError("window dimensions must fit inside the room")
    if not 0 < scene.window_sill_height_m < scene.room_height_m - scene.window_height_m:
        raise ConfigurationError("window sill and height must fit inside the room")
    if not 10 <= scene.window_open_angle_degrees <= 80:
        raise ConfigurationError("window open angle must be between 10 and 80 degrees")
    camera = config.camera
    if min(camera.move_speed_m_s, camera.fast_move_multiplier, camera.acceleration, camera.wheel_step_m) <= 0:
        raise ConfigurationError("camera speed, acceleration and wheel step must be positive")
    if camera.mouse_sensitivity <= 0 or camera.transition_seconds <= 0:
        raise ConfigurationError("camera sensitivity and transition time must be positive")
    if not -89 < camera.min_pitch_degrees < camera.max_pitch_degrees < 89:
        raise ConfigurationError("camera pitch limits must be ordered within -89 and 89 degrees")
    if (
        not 20 <= camera.field_of_view_degrees <= 110
        or not 0 < camera.near_plane_m < camera.far_plane_m
        or camera.focus_distance_min_m <= 0
    ):
        raise ConfigurationError("camera field of view or clipping planes are invalid")
    if config.logging.level.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ConfigurationError("logging level is not a standard Python log level")
    if config.logging.max_bytes < 1 or config.logging.backup_count < 0:
        raise ConfigurationError("logging rotation settings are invalid")


def load_config(
    config_dir: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> AppConfig:
    directory = (config_dir or DEFAULT_CONFIG_DIR).expanduser().resolve()
    config_names = ("room", "devices", "physics", "backend", "graphics", "camera", "scene", "logging")
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
    lighting_table = _section(raw["graphics"], "lighting", paths["graphics"])
    camera_table = _section(raw["camera"], "camera", paths["camera"])
    scene_table = _section(raw["scene"], "scene", paths["scene"])
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
            ui_font_path=_text(graphics_table, "ui_font_path", "graphics.toml [graphics]"),
            multisample_enabled=_boolean(lighting_table, "multisample_enabled", "graphics.toml [lighting]"),
            multisamples=_integer(lighting_table, "multisamples", "graphics.toml [lighting]"),
            shadows_enabled=_boolean(lighting_table, "shadows_enabled", "graphics.toml [lighting]"),
            shadow_map_size=_integer(lighting_table, "shadow_map_size", "graphics.toml [lighting]"),
            ambient_rgb=_color(lighting_table, "ambient_rgb", "graphics.toml [lighting]"),
            sun_rgb=_color(lighting_table, "sun_rgb", "graphics.toml [lighting]"),
        )
        camera = CameraConfig(
            start_position=_vector3(camera_table, "start_position", "camera.toml [camera]"),
            start_target=_vector3(camera_table, "start_target", "camera.toml [camera]"),
            move_speed_m_s=_number(camera_table, "move_speed_m_s", "camera.toml [camera]"),
            fast_move_multiplier=_number(camera_table, "fast_move_multiplier", "camera.toml [camera]"),
            acceleration=_number(camera_table, "acceleration", "camera.toml [camera]"),
            mouse_sensitivity=_number(camera_table, "mouse_sensitivity", "camera.toml [camera]"),
            wheel_step_m=_number(camera_table, "wheel_step_m", "camera.toml [camera]"),
            transition_seconds=_number(camera_table, "transition_seconds", "camera.toml [camera]"),
            min_pitch_degrees=_number(camera_table, "min_pitch_degrees", "camera.toml [camera]"),
            max_pitch_degrees=_number(camera_table, "max_pitch_degrees", "camera.toml [camera]"),
            field_of_view_degrees=_number(camera_table, "field_of_view_degrees", "camera.toml [camera]"),
            near_plane_m=_number(camera_table, "near_plane_m", "camera.toml [camera]"),
            far_plane_m=_number(camera_table, "far_plane_m", "camera.toml [camera]"),
            focus_distance_min_m=_number(camera_table, "focus_distance_min_m", "camera.toml [camera]"),
        )
        scene = SceneConfig(
            room_width_m=_number(scene_table, "room_width_m", "scene.toml [scene]"),
            room_depth_m=_number(scene_table, "room_depth_m", "scene.toml [scene]"),
            room_height_m=_number(scene_table, "room_height_m", "scene.toml [scene]"),
            wall_thickness_m=_number(scene_table, "wall_thickness_m", "scene.toml [scene]"),
            platform_margin_m=_number(scene_table, "platform_margin_m", "scene.toml [scene]"),
            window_width_m=_number(scene_table, "window_width_m", "scene.toml [scene]"),
            window_height_m=_number(scene_table, "window_height_m", "scene.toml [scene]"),
            window_sill_height_m=_number(scene_table, "window_sill_height_m", "scene.toml [scene]"),
            outdoor_depth_m=_number(scene_table, "outdoor_depth_m", "scene.toml [scene]"),
            window_open_angle_degrees=_number(scene_table, "window_open_angle_degrees", "scene.toml [scene]"),
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
        scene=scene,
        camera=camera,
        logging=logging_config,
    )
    _validate(config)
    return config
