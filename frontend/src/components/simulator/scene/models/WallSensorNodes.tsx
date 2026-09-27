'use client'

import { Text } from '@react-three/drei'
import type { SimulatorSnapshot, VisualizationMode } from '../../types'
import { Pickable } from '../Pickable'
import { Fastener, Housing, MountingScrews, StatusLed, VentSlats } from './parts'
import { INDOOR_NODE_OFFSETS, OUTDOOR_NODE_OFFSETS } from './geometry'

type Point3 = [number, number, number]
type Select = (id: string, point: Point3) => void

function NodeLabel({ children, position, size = 0.054, rotation = [0, 0, 0] }: { children: string; position: Point3; size?: number; rotation?: [number, number, number] }) {
  return <Text position={position} rotation={rotation} fontSize={size} color="#35494a" anchorX="center" anchorY="middle" outlineWidth={0.002} outlineColor="#f5f3e9">{children}</Text>
}

function ModuleBoard({ type }: { type: 'scd41' | 'sht45' }) {
  const size: Point3 = type === 'scd41' ? [0.064, 0.044, 0.004] : [0.046, 0.030, 0.003]
  const chip: Point3 = type === 'scd41' ? [0.015, 0.014, 0.006] : [0.009, 0.008, 0.005]
  const padCount = type === 'scd41' ? 6 : 4
  return (
    <group>
      <Housing position={[0, 0, 0]} size={size} color="#146b51" radius={0.002} roughness={0.58} />
      <mesh position={[0, 0, 0.003]}>
        <boxGeometry args={chip} />
        <meshStandardMaterial color="#e3e2d7" roughness={0.38} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0, 0.006]}>
        <boxGeometry args={[chip[0] * 0.46, chip[1] * 0.42, 0.0015]} />
        <meshStandardMaterial color="#283439" roughness={0.35} />
      </mesh>
      {Array.from({ length: padCount }, (_, index) => (
        <mesh key={index} position={[-size[0] * 0.43 + index * (size[0] * 0.86 / (padCount - 1)), -size[1] * 0.31, 0.003]}>
          <boxGeometry args={[0.004, 0.005, 0.001]} />
          <meshStandardMaterial color="#c7a653" metalness={0.68} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[size[0] * 0.39, size[1] * 0.31, 0.005]}>
        <boxGeometry args={[0.004, 0.004, 0.003]} />
        <meshStandardMaterial color="#bfc7bb" metalness={0.54} roughness={0.38} />
      </mesh>
    </group>
  )
}

function ParticleSensorBody() {
  return (
    <group>
      {/* The SPS30 package is 41 × 41 × 12 mm; the printed labels are deliberately omitted at this scale. */}
      <Housing position={[0, 0, 0]} size={[0.041, 0.041, 0.012]} color="#d6d6cf" radius={0.0025} roughness={0.84} />
      <mesh position={[0, 0.008, 0.007]}>
        <boxGeometry args={[0.026, 0.011, 0.002]} />
        <meshStandardMaterial color="#697779" roughness={0.72} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.013, -0.010, 0.007]}>
          {[0, 1, 2].map((slot) => <mesh key={slot} position={[0, slot * 0.004, 0]}><boxGeometry args={[0.009, 0.0015, 0.0015]} /><meshStandardMaterial color="#526265" /></mesh>)}
        </group>
      ))}
      <mesh position={[0.017, -0.012, -0.002]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.010, 12]} />
        <meshStandardMaterial color="#627377" roughness={0.48} />
      </mesh>
    </group>
  )
}

export function IndoorSensorNode({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  onSelect: Select
}) {
  const center = snapshot.simulation.layout.indoor_sensor_center
  const x = center[0]
  const y = center[2]
  const panelWidth = snapshot.simulation.mount_dimensions.indoor_panel_width_m
  const panelHeight = snapshot.simulation.mount_dimensions.indoor_panel_height_m
  const z = snapshot.simulation.room_dimensions.depth_m / 2
    - snapshot.simulation.room_dimensions.wall_thickness_m / 2
    - 0.041
  const online = new Map(snapshot.sensors.map((sensor) => [sensor.id, sensor.online]))
  const scdOnline = online.get('indoor_climate') ?? false
  const pmOnline = online.get('indoor_particles') ?? false

  return (
    <group position={[x, y, z]}>
      {/* Wall backplate and a shallow ventilated enclosure keep both sensors at room-sensing height. */}
      <Housing position={[0, 0, 0.047]} size={[panelWidth, panelHeight, 0.026]} color="#627273" radius={0.018} roughness={0.64} metalness={0.26} />
      <Housing position={[0, 0, 0]} size={[panelWidth - 0.04, panelHeight - 0.04, 0.082]} color="#e6e6dc" radius={0.028} roughness={0.78} />
      <Housing position={[0, panelHeight * 0.442, -0.047]} size={[panelWidth * 0.69, 0.032, 0.014]} color="#d4d8ce" radius={0.008} />
      <MountingScrews width={panelWidth - 0.05} height={panelHeight - 0.05} z={-0.050} inset={0.035} facing={-1} />
      <NodeLabel position={[0, panelHeight * 0.59, -0.060]} size={0.055} rotation={[0, Math.PI, 0]}>ВНУТРЕННИЙ УЗЕЛ</NodeLabel>

      <group position={INDOOR_NODE_OFFSETS.scd41.module} rotation={[0, Math.PI, 0]}>
        <Pickable id="sensor.scd41.indoor" position={[0, 0, 0]} bounds={[0.14, 0.12, 0.10]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <Housing position={[0, 0, 0.020]} size={[0.116, 0.091, 0.040]} color="#f1f0e8" radius={0.012} />
          <Housing position={[0, -0.002, 0.043]} size={[0.079, 0.058, 0.006]} color="#bbcbc1" radius={0.006} />
          <ModuleBoard type="scd41" />
          <VentSlats width={0.075} count={5} y={0.012} z={0.045} color="#899b97" thickness={0.003} />
          <mesh position={[-0.064, -0.047, 0.045]}><boxGeometry args={[0.026, 0.018, 0.007]} /><meshStandardMaterial color="#80908b" roughness={0.68} /></mesh>
          <StatusLed position={[0.071, 0.047, 0.048]} active={scdOnline} size={0.006} />
          <Housing position={[0, -0.073, 0.055]} size={[0.050, 0.016, 0.013]} color="#4a5a5d" radius={0.004} />
          {[-1, 0, 1].map((index) => <mesh key={index} position={[index * 0.014, -0.073, 0.063]}><cylinderGeometry args={[0.0013, 0.0013, 0.012, 6]} /><meshStandardMaterial color="#b5a05e" metalness={0.7} /></mesh>)}
          <Housing position={[0.079, -0.041, 0.020]} size={[0.018, 0.022, 0.031]} color="#d7d8d0" radius={0.004} />
        </Pickable>
      </group>

      <group position={INDOOR_NODE_OFFSETS.sps30.module} rotation={[0, Math.PI, 0]}>
        <Pickable id="sensor.sps30.indoor" position={[0, 0, 0]} bounds={[0.11, 0.12, 0.11]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <Housing position={[0, 0, 0.016]} size={[0.092, 0.092, 0.044]} color="#e8e8df" radius={0.012} />
          <mesh position={[0, 0, 0.043]}><boxGeometry args={[0.067, 0.067, 0.006]} /><meshStandardMaterial color="#4f6265" roughness={0.74} /></mesh>
          <group position={[0, 0, 0.050]}><ParticleSensorBody /></group>
          <Housing position={[0, -0.084, 0.047]} size={[0.060, 0.016, 0.017]} color="#505f61" radius={0.004} />
          {[-1, 0, 1].map((index) => <mesh key={index} position={[index * 0.017, -0.084, 0.058]}><cylinderGeometry args={[0.0015, 0.0015, 0.012, 6]} /><meshStandardMaterial color="#b5a05e" metalness={0.7} /></mesh>)}
          <StatusLed position={[0.070, 0.064, 0.046]} active={pmOnline} size={0.006} />
          {[-1, 1].map((side) => <mesh key={side} position={[side * 0.073, 0.020, 0.046]}><boxGeometry args={[0.006, 0.070, 0.006]} /><meshStandardMaterial color="#9ba7a2" roughness={0.68} /></mesh>)}
        </Pickable>
      </group>

      {/* The lower opening is the sampling-air inlet; the gland sits below the cover. */}
      <group>
        <VentSlats width={0.28} count={4} y={-0.245} z={0.048} color="#8f9d99" thickness={0.004} />
        <mesh position={[0, -0.326, -0.050]}><cylinderGeometry args={[0.016, 0.016, 0.020, 14]} /><meshStandardMaterial color="#526265" metalness={0.38} roughness={0.56} /></mesh>
        <mesh position={[0, -0.326, -0.062]}><cylinderGeometry args={[0.010, 0.010, 0.004, 14]} /><meshStandardMaterial color="#d6d8cf" roughness={0.66} /></mesh>
      </group>
      <Fastener position={[-0.22, 0.25, -0.052]} scale={0.72} facing={-1} />
      <Fastener position={[0.22, 0.25, -0.052]} scale={0.72} facing={-1} />
      <Fastener position={[-0.22, -0.25, -0.052]} scale={0.72} facing={-1} />
      <Fastener position={[0.22, -0.25, -0.052]} scale={0.72} facing={-1} />
    </group>
  )
}

export function OutdoorSensorNode({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  onSelect: Select
}) {
  const center = snapshot.simulation.layout.outdoor_station_center
  const online = new Map(snapshot.sensors.map((sensor) => [sensor.id, sensor.online]))
  const shtOnline = online.get('outdoor_climate') ?? false
  const pmOnline = online.get('outdoor_particles') ?? false

  return (
    <group position={[center[0], center[2], center[1]]}>
      {/* Galvanized stand-off bracket, UV-stable rain cap and ventilated radiation shield. */}
      <Housing position={[0, -0.01, -0.1525]} size={[0.10, 0.42, 0.055]} color="#718181" radius={0.008} metalness={0.34} />
      <Housing position={[-0.16, 0.02, -0.095]} size={[0.036, 0.40, 0.12]} color="#899492" radius={0.006} metalness={0.38} />
      <Housing position={[0.16, 0.02, -0.095]} size={[0.036, 0.40, 0.12]} color="#899492" radius={0.006} metalness={0.38} />
      <Housing position={[0, 0.286, 0.018]} size={[0.40, 0.060, 0.28]} color="#e6e8e0" radius={0.018} roughness={0.82} />
      <Housing position={[0, -0.275, 0.025]} size={[0.34, 0.032, 0.25]} color="#d6d9d1" radius={0.012} />
      <Housing position={[-0.16, 0.015, 0.035]} size={[0.032, 0.49, 0.22]} color="#d9ddd5" radius={0.008} />
      <Housing position={[0.16, 0.015, 0.035]} size={[0.032, 0.49, 0.22]} color="#d9ddd5" radius={0.008} />
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={index} position={[0, -0.173 + index * 0.044, 0.135]} castShadow>
          <boxGeometry args={[0.28, 0.014, 0.14]} />
          <meshStandardMaterial color={index % 2 ? '#c6ccc4' : '#d1d6ce'} roughness={0.76} />
        </mesh>
      ))}
      <Housing position={[0, 0.229, 0.086]} size={[0.34, 0.025, 0.15]} color="#dce0d8" radius={0.006} />
      <NodeLabel position={[0, 0.40, 0.15]} size={0.052}>НАРУЖНЫЙ УЗЕЛ</NodeLabel>
      <MountingScrews width={0.30} height={0.43} z={0.192} inset={0.018} />

      <group position={OUTDOOR_NODE_OFFSETS.sht45.module}>
        <Pickable id="sensor.sht45.outdoor" position={[0, 0, 0]} bounds={[0.17, 0.12, 0.09]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <Housing position={[0, 0, 0.012]} size={[0.15, 0.092, 0.035]} color="#eef0e8" radius={0.009} />
          <ModuleBoard type="sht45" />
          <mesh position={[0, 0.005, 0.006]}><boxGeometry args={[0.013, 0.011, 0.003]} /><meshStandardMaterial color="#f3eee0" roughness={0.36} /></mesh>
          <mesh position={[0.039, -0.022, 0.024]}><boxGeometry args={[0.027, 0.015, 0.010]} /><meshStandardMaterial color="#4c5d5f" roughness={0.54} /></mesh>
          {[0, 1, 2, 3].map((index) => <mesh key={index} position={[-0.012 + index * 0.008, -0.023, 0.029]}><cylinderGeometry args={[0.0012, 0.0012, 0.011, 6]} /><meshStandardMaterial color="#c2a55b" metalness={0.7} /></mesh>)}
          <StatusLed position={[0.060, 0.034, 0.031]} active={shtOnline} size={0.0055} />
        </Pickable>
      </group>

      <group position={OUTDOOR_NODE_OFFSETS.sps30.module}>
        <Pickable id="sensor.sps30.outdoor" position={[0, 0, 0]} bounds={[0.17, 0.18, 0.11]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <Housing position={[0, 0, 0.010]} size={[0.15, 0.15, 0.038]} color="#e2e4dc" radius={0.008} />
          <mesh position={[0, 0, 0.034]}><boxGeometry args={[0.089, 0.084, 0.005]} /><meshStandardMaterial color="#56676a" roughness={0.7} /></mesh>
          <group position={[0, 0, 0.040]}><ParticleSensorBody /></group>
          <VentSlats width={0.074} count={4} y={-0.051} z={0.037} color="#66777a" thickness={0.0025} />
          <Housing position={[0.056, -0.060, 0.042]} size={[0.029, 0.018, 0.014]} color="#536365" radius={0.004} />
          <StatusLed position={[0.064, 0.060, 0.041]} active={pmOnline} size={0.0055} />
          <mesh position={[-0.013, -0.064, -0.002]} rotation={[0, Math.PI / 2, 0]}><cylinderGeometry args={[0.006, 0.006, 0.012, 12]} /><meshStandardMaterial color="#76878a" /></mesh>
        </Pickable>
      </group>

      <mesh position={[0, -0.292, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.036, 16]} />
        <meshStandardMaterial color="#596a6b" metalness={0.32} roughness={0.52} />
      </mesh>
      <mesh position={[0, -0.292, 0.102]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.008, 16]} />
        <meshStandardMaterial color="#d4d9d1" roughness={0.68} />
      </mesh>
      <Fastener position={[-0.20, 0.20, 0.207]} scale={0.75} />
      <Fastener position={[0.20, 0.20, 0.207]} scale={0.75} />
      <Fastener position={[-0.20, -0.20, 0.207]} scale={0.75} />
      <Fastener position={[0.20, -0.20, 0.207]} scale={0.75} />
    </group>
  )
}
