"""Per-sensor v2 telemetry; retries retain the original boot/sequence and clock."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
import math
import time
import uuid

from aircheck_simulator_3d.simulation.state import SimulationState
from aircheck_simulator_3d.simulation.virtual_sensors import SensorReadingUnavailable, read_sensor_value

CHANNELS = {
    'indoor_climate': ('indoor', ('co2', 'temperature', 'humidity')),
    'outdoor_climate': ('outdoor', ('temperature', 'humidity')),
    'indoor_particles': ('indoor', ('pm25',)),
    'outdoor_particles': ('outdoor', ('pm25',)),
}

@dataclass(frozen=True)
class DeviceTelemetryPayload:
    _payload: dict[str, object]

    def to_mapping(self) -> dict[str, object]:
        return deepcopy(self._payload)

class TelemetryBuilder:
    def __init__(self, device_id: str) -> None:
        self.device_id = device_id
        self.boot_id = 'sim-' + uuid.uuid4().hex
        self.sequence = 0
        self.started = time.monotonic()
        self.last_good: dict[str, tuple[datetime, dict[str, float]]] = {}
        self.failures: dict[str, int] = {}

    def build(self, state: SimulationState, timestamp: datetime) -> DeviceTelemetryPayload:
        if timestamp.tzinfo is None:
            raise ValueError('Telemetry requires UTC-aware wall time')
        iso = timestamp.isoformat().replace('+00:00', 'Z')
        sensors = []
        for sensor_id, (zone, channels) in CHANNELS.items():
            try:
                values = {key: read_sensor_value(state, zone, key) for key in channels}
                if not all(math.isfinite(value) for value in values.values()):
                    raise ValueError('non-finite reading')
                self.last_good[sensor_id] = (timestamp, values)
                self.failures[sensor_id] = 0
                status = reason = 'ok'
            except SensorReadingUnavailable:
                status, reason = 'timeout', 'virtual sensor offline'
                self.failures[sensor_id] = self.failures.get(sensor_id, 0) + 1
            except ValueError:
                status, reason = 'range', 'invalid virtual reading'
                self.failures[sensor_id] = self.failures.get(sensor_id, 0) + 1
            last = self.last_good.get(sensor_id)
            sensors.append({'sensor_id': sensor_id, 'status': status, 'reason': reason,
                'last_good_at': last[0].isoformat().replace('+00:00', 'Z') if last else None,
                'age_ms': max(0, round((timestamp - last[0]).total_seconds() * 1000)) if last else 0,
                'consecutive_failures': self.failures[sensor_id], 'values': dict(last[1]) if last else {key: None for key in channels}})
        window = state.window
        def fan(value):
            return {'requested_on': value.enabled, 'rpm': value.rpm, 'status': 'measured'}
        payload = {'schema_version': 2, 'device_id': self.device_id, 'data_source': 'simulator',
            'boot_id': self.boot_id, 'sequence': self.sequence, 'sampled_at': iso, 'sensors': sensors,
            'controller': {'uptime_ms': round((time.monotonic() - self.started) * 1000), 'reset_reason': None,
                'firmware_version': 'virtual-2.0', 'free_heap': None, 'minimum_free_heap': None,
                'clock_synced': True, 'outputs_commissioned': True, 'dropped_packets': 0, 'queue_depth': 0},
            'actuators': {'window': {'open_limit': window.open_limit_switch, 'close_limit': window.close_limit_switch,
                'reed_switch': window.reed_switch, 'position_percent': window.actual_position_percent,
                'position_quality': 'measured', 'motion': str(window.motor_state)},
                'intake': fan(state.ventilation.intake), 'exhaust': fan(state.ventilation.exhaust)}, 'command_results': []}
        self.sequence += 1
        return DeviceTelemetryPayload(payload)
