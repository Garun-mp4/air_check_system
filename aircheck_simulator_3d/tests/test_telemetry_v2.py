from dataclasses import replace
from datetime import datetime, timedelta, timezone

from aircheck_simulator_3d.tests.support import new_simulation
from aircheck_simulator_3d.networking.telemetry import TelemetryBuilder

def test_partial_failure_preserves_healthy_channels_and_last_good_identity():
    state = new_simulation().state
    builder = TelemetryBuilder('room-01')
    now = datetime.now(timezone.utc)
    first = builder.build(state, now)
    original = first.to_mapping()
    state.sensors = tuple(replace(sensor, online=False) if sensor.sensor_id == 'outdoor_particles' else sensor for sensor in state.sensors)
    second = builder.build(state, now + timedelta(seconds=5)).to_mapping()
    sensors = {sensor['sensor_id']: sensor for sensor in second['sensors']}
    assert sensors['outdoor_particles']['status'] == 'timeout'
    assert sensors['outdoor_particles']['age_ms'] == 5000
    assert sensors['outdoor_particles']['values'] == original['sensors'][3]['values']
    assert sensors['indoor_climate']['status'] == 'ok'
    assert second['boot_id'] == original['boot_id'] and second['sequence'] == original['sequence'] + 1
    assert first.to_mapping() == original
    assert second['controller']['free_heap'] is None

def test_initial_missing_sensor_is_null_and_recovers_without_other_channels_stopping():
    state = new_simulation().state
    state.sensors = tuple(replace(sensor, online=False) if sensor.sensor_id == 'indoor_climate' else sensor for sensor in state.sensors)
    builder = TelemetryBuilder('room-01')
    now = datetime.now(timezone.utc)
    missing = builder.build(state, now).to_mapping()['sensors'][0]
    assert missing['last_good_at'] is None and missing['values']['co2'] is None
    state.sensors = tuple(replace(sensor, online=True) for sensor in state.sensors)
    recovered = builder.build(state, now + timedelta(seconds=5)).to_mapping()['sensors'][0]
    assert recovered['status'] == 'ok' and recovered['consecutive_failures'] == 0
