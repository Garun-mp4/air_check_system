import type { SensorQuality, StoredTelemetry } from './telemetry'

export interface AirReading {
  co2_ppm: number | null
  pm25_ug_m3: number | null
  temperature_c: number | null
  humidity_percent: number | null
}

export interface SensorState {
  id: string
  model: string
  zone: 'indoor' | 'window' | 'outdoor'
  interface: string
  measurements: string[]
  online: boolean
  quality?: SensorQuality
  reason?: string
  last_good_at?: string | null
  age_ms?: number | null
  readings: Record<string, number | null>
}

export interface FanState {
  enabled: boolean | null
  rpm: number | null
  airflow_m3_h: number | null
  nominal_rpm: number | null
  nominal_airflow_m3_h: number | null
  rated_power_w: number | null
}

export interface DeveloperParameter {
  minimum: number
  maximum: number
  step: number
  integral: boolean
}

export interface SystemSnapshot {
  mode?: 'real' | 'simulation'
  data_source?: 'real' | 'simulator'
  telemetry?: StoredTelemetry | null
  settings?: { co2_normal_threshold: number; co2_critical_threshold: number; pm25_good_limit: number; pm25_elevated_limit: number; updated_at?: string }
  connection?: { controller: 'online' | 'stale' | 'offline'; received_at: string | null; assessed_at: string }
  warnings?: string[]
  schema_version: number
  revision: number
  device_id: string
  timestamp: string
  simulation: {
    elapsed_seconds: number | null
    speed: number | null
    fixed_step_seconds: number | null
    room_volume_m3: number
    occupancy: number | null
    scenario: string
    scenarios: { id: string; title: string }[]
    supported_speeds: number[]
    developer_values: Record<string, number>
    developer_parameters: Record<string, DeveloperParameter>
    room_dimensions: {
      width_m: number
      depth_m: number
      height_m: number
      wall_thickness_m: number
      window_width_m: number
      window_height_m: number
      window_sill_height_m: number
      window_open_angle_degrees: number
      outdoor_depth_m: number
    }
    layout: {
      indoor_sensor_center: [number, number, number]
      outdoor_station_center: [number, number, number]
      control_cabinet_center: [number, number, number]
      controller_drop_x: number
      rear_channel_y: number
      rear_wire_y: number
      exterior_channel_y: number
      exterior_wire_y: number
      trunk_z: number
      exterior_entry_x: number
      outdoor_gland_x: number
      outdoor_gland_z: number
      indoor_drop_x: number
    }
    mount_dimensions: {
      control_cabinet_width_m: number
      control_cabinet_height_m: number
      indoor_panel_width_m: number
      indoor_panel_height_m: number
    }
    camera: {
      start_position: [number, number, number]
      start_target: [number, number, number]
      move_speed_m_s: number
      fast_move_multiplier: number
      mouse_sensitivity: number
      wheel_step_m: number
      transition_seconds: number
      min_pitch_degrees: number
      max_pitch_degrees: number
      field_of_view_degrees: number
      near_plane_m: number
      far_plane_m: number
      focus_distance_min_m: number
    }
  }
  indoor: AirReading
  outdoor: AirReading
  sensors: SensorState[]
  window: {
    target_position_percent: number | null
    actual_position_percent: number | null
    last_known_position_percent?: number
    motor_state: 'stopped' | 'opening' | 'closing' | 'fault' | 'unknown'
    position_quality?: 'unknown' | 'measured' | 'estimated' | 'stale' | 'simulated'
    reed_switch: boolean | null
    open_limit_switch: boolean | null
    close_limit_switch: boolean | null
  }
  ventilation: {
    intake: FanState
    exhaust: FanState
    filter_enabled: boolean | null
    filter_efficiency: number | null
  }
  airflow: {
    infiltration_m3_h: number | null
    window_m3_h: number | null
    intake_m3_h: number | null
    exhaust_m3_h: number | null
    total_effective_m3_h: number | null
    air_changes_per_hour: number | null
  }
  energy: {
    fan_energy_wh: number | null
    estimated_ventilation_heat_loss_wh: number | null
    total_relative_energy: number | null
  }
  backend: {
    online: boolean
    message: string | null
    last_telemetry_at: string | null
    pending_commands: number
    forecast: null | {
      predicted_co2_15min: number | null
      predicted_co2?: number
      horizon_minutes?: number
      target_time: string | null
      model_name: string | null
      model_version: string | null
    }
  }
  demo: { active: boolean; phase: string; detail: string }
}

