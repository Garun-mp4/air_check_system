export type VisualizationMode = 'normal' | 'airflow' | 'sensors' | 'wiring' | 'technical'
export type CutawayMode = 'visible' | 'transparent' | 'hidden'
export type AccessRole = 'guest' | 'user' | 'operator' | 'owner'

export interface AirReading {
  co2_ppm: number
  pm25_ug_m3: number
  temperature_c: number
  humidity_percent: number
}

export interface SensorState {
  id: string
  model: string
  zone: 'indoor' | 'window' | 'outdoor'
  interface: string
  measurements: string[]
  online: boolean
  readings: Record<string, number | null>
}

export interface FanState {
  enabled: boolean
  rpm: number
  airflow_m3_h: number
  nominal_rpm: number
  nominal_airflow_m3_h: number
  rated_power_w: number
}

export interface DeveloperParameter {
  minimum: number
  maximum: number
  step: number
  integral: boolean
}

export interface SimulatorSnapshot {
  schema_version: number
  revision: number
  device_id: string
  timestamp: string
  simulation: {
    elapsed_seconds: number
    speed: number
    fixed_step_seconds: number
    room_volume_m3: number
    occupancy: number
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
    target_position_percent: number
    actual_position_percent: number
    motor_state: 'stopped' | 'opening' | 'closing' | 'fault'
    reed_switch: boolean
    open_limit_switch: boolean
    close_limit_switch: boolean
  }
  ventilation: {
    intake: FanState
    exhaust: FanState
    filter_enabled: boolean
    filter_efficiency: number
  }
  airflow: {
    infiltration_m3_h: number
    window_m3_h: number
    intake_m3_h: number
    exhaust_m3_h: number
    total_effective_m3_h: number
    air_changes_per_hour: number
  }
  energy: {
    fan_energy_wh: number
    estimated_ventilation_heat_loss_wh: number
    total_relative_energy: number
  }
  backend: {
    online: boolean
    message: string | null
    last_telemetry_at: string | null
    pending_commands: number
    forecast: null | {
      predicted_co2_15min: number
      target_time: string | null
      model_name: string | null
      model_version: string | null
    }
  }
  demo: { active: boolean; phase: string; detail: string }
}

export interface AccessInfo {
  userId: string | null
  email: string | null
  name: string | null
  role: AccessRole
  operatorExpiresAt: string | null
}
