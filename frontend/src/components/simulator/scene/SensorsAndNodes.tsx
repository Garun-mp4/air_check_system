'use client'

import { Text } from '@react-three/drei'

import type { SimulatorSnapshot, VisualizationMode } from '../types'
import { Pickable } from './Pickable'

type Point = [number, number, number]

function toWorld(point: [number, number, number]): Point {
  return [point[0], point[2], point[1]]
}

function Label({ children, position, color = '#294149', size = 0.075 }: { children: string; position: Point; color?: string; size?: number }) {
  return <Text position={position} fontSize={size} color={color} anchorX="center" anchorY="middle" outlineWidth={0.003} outlineColor="#f8fbf5">{children}</Text>
}

function SensorBoard({
  id,
  label,
  position,
  selectedId,
  mode,
  online,
  size,
  onSelect,
}: {
  id: string
  label: string
  position: Point
  selectedId: string | null
  mode: VisualizationMode
  online: boolean
  size: Point
  onSelect: (id: string, point: Point) => void
}) {
  return (
    <Pickable id={id} position={position} bounds={size} selectedId={selectedId} mode={mode} onSelect={onSelect}>
      <mesh castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#147e70" roughness={0.68} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.023, 0.004]}>
        <boxGeometry args={[size[0] * 0.45, 0.012, size[2] * 0.52]} />
        <meshStandardMaterial color="#dce4d8" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.031, 0.012]}>
        <boxGeometry args={[size[0] * 0.18, 0.014, size[2] * 0.23]} />
        <meshStandardMaterial color="#27373b" metalness={0.2} roughness={0.42} />
      </mesh>
      {[-1, 1].map((side) => <mesh key={side} position={[side * size[0] * 0.47, 0, 0]}><boxGeometry args={[0.025, size[1] * 1.16, size[2] * 1.3]} /><meshStandardMaterial color="#c1a55d" metalness={0.4} roughness={0.42} /></mesh>)}
      <mesh position={[size[0] * 0.33, 0.035, -size[2] * 0.3]}>
        <sphereGeometry args={[0.022, 12, 8]} />
        <meshStandardMaterial color={online ? '#27a879' : '#d78043'} emissive={online ? '#155a40' : '#613318'} />
      </mesh>
      <Label position={[0, size[1] * 0.72, 0.018]} size={0.052}>{label}</Label>
    </Pickable>
  )
}

export default function SensorsAndNodes({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  onSelect: (id: string, point: Point) => void
}) {
  const { room_dimensions: d, layout, mount_dimensions: mounts } = snapshot.simulation
  const indoorCenter = toWorld(layout.indoor_sensor_center)
  const outdoorCenter = toWorld(layout.outdoor_station_center)
  const cabinetCenter = toWorld(layout.control_cabinet_center)
  const indoorPanelPosition: Point = [indoorCenter[0], indoorCenter[1], indoorCenter[2] - 0.04]
  const outdoorBack = d.depth_m / 2 + d.wall_thickness_m
  const cabinetWidth = mounts.control_cabinet_width_m
  const cabinetHeight = mounts.control_cabinet_height_m
  const powerY = cabinetCenter[1]
  const frontZ = cabinetCenter[2] + 0.10
  const sensorById = new Map(snapshot.sensors.map((sensor) => [sensor.id, sensor]))
  const indoorOnline = sensorById.get('indoor_climate')?.online ?? false
  const indoorParticlesOnline = sensorById.get('indoor_particles')?.online ?? false
  const outdoorClimateOnline = sensorById.get('outdoor_climate')?.online ?? false
  const outdoorParticlesOnline = sensorById.get('outdoor_particles')?.online ?? false

  const cabinetDevices = [
    { id: 'device.esp32', label: 'ESP32', x: -0.38, z: 0.48, w: 0.48, h: 0.26, color: '#137d70' },
    { id: 'power.dc_dc', label: 'DC/DC 12→5 V', x: 0.38, z: 0.48, w: 0.38, h: 0.22, color: '#26836f' },
    { id: 'power.mosfet_module', label: 'MOSFET · 2 ch', x: 0.38, z: 0.06, w: 0.38, h: 0.22, color: '#258078' },
    { id: 'power.h_bridge', label: 'H-мост', x: 0.38, z: -0.36, w: 0.38, h: 0.25, color: '#426c78' },
    { id: 'power.psu_12v', label: 'БП 12 V', x: -0.38, z: 0.02, w: 0.48, h: 0.31, color: '#d9e0d8' },
    { id: 'power.fuses', label: 'Предохранители', x: -0.38, z: -0.36, w: 0.44, h: 0.17, color: '#cc9b48' },
    { id: 'power.terminal_blocks', label: '+12 V   GND   5 V   DATA', x: 0, z: -0.70, w: 1.08, h: 0.14, color: '#587b8a' },
  ]

  return (
    <group>
      {/* Indoor wall mounted instrument panel and sensors */}
      <mesh position={indoorPanelPosition} castShadow>
        <boxGeometry args={[mounts.indoor_panel_width_m, mounts.indoor_panel_height_m, 0.08]} />
        <meshStandardMaterial color="#647c7d" roughness={0.74} metalness={0.12} />
      </mesh>
      <mesh position={[indoorPanelPosition[0], indoorPanelPosition[1], indoorPanelPosition[2] - 0.045]}>
        <boxGeometry args={[mounts.indoor_panel_width_m - 0.09, mounts.indoor_panel_height_m - 0.10, 0.025]} />
        <meshStandardMaterial color="#e3e8dc" roughness={0.82} />
      </mesh>
      <SensorBoard id="sensor.scd41.indoor" label="SCD41 · CO₂ / T / RH" position={[indoorCenter[0] - 0.17, indoorCenter[1] + 0.24, indoorPanelPosition[2] + 0.025]} selectedId={selectedId} mode={mode} online={indoorOnline} size={[0.42, 0.055, 0.24]} onSelect={onSelect} />
      <SensorBoard id="sensor.sps30.indoor" label="SPS30 · PM1–PM10" position={[indoorCenter[0] + 0.18, indoorCenter[1] - 0.20, indoorPanelPosition[2] + 0.06]} selectedId={selectedId} mode={mode} online={indoorParticlesOnline} size={[0.43, 0.22, 0.43]} onSelect={onSelect} />
      <Label position={[indoorCenter[0], indoorCenter[1] + mounts.indoor_panel_height_m / 2 + 0.11, indoorPanelPosition[2]]}>ВНУТРЕННИЙ УЗЕЛ</Label>
      <mesh position={[indoorCenter[0], indoorCenter[1] - 0.44, indoorPanelPosition[2] + 0.04]}>
        <boxGeometry args={[0.62, 0.11, 0.035]} />
        <meshStandardMaterial color="#7a8880" roughness={0.76} />
      </mesh>

      {/* Weather shield mounted on the exterior face of the same wall */}
      <mesh position={outdoorCenter} castShadow>
        <boxGeometry args={[0.78, 0.96, 0.15]} />
        <meshStandardMaterial color="#91a69a" roughness={0.84} />
      </mesh>
      <mesh position={[outdoorCenter[0], outdoorCenter[1] + 0.49, outdoorCenter[2] + 0.06]} castShadow>
        <boxGeometry args={[0.91, 0.11, 0.48]} />
        <meshStandardMaterial color="#c3d0bd" roughness={0.7} />
      </mesh>
      {[-1, 1].map((side) => <mesh key={side} position={[outdoorCenter[0] + side * 0.40, outdoorCenter[1], outdoorCenter[2] + 0.05]}><boxGeometry args={[0.055, 0.78, 0.38]} /><meshStandardMaterial color="#b8c6b8" roughness={0.8} /></mesh>)}
      {Array.from({ length: 5 }, (_, index) => <mesh key={index} position={[outdoorCenter[0], outdoorCenter[1] - 0.22 + index * 0.12, outdoorCenter[2] + 0.13]}><boxGeometry args={[0.65, 0.024, 0.055]} /><meshStandardMaterial color="#718681" roughness={0.64} /></mesh>)}
      <SensorBoard id="sensor.sht45.outdoor" label="SHT45 · T / RH" position={[outdoorCenter[0] + 0.12, outdoorCenter[1] + 0.23, outdoorCenter[2] + 0.15]} selectedId={selectedId} mode={mode} online={outdoorClimateOnline} size={[0.31, 0.045, 0.16]} onSelect={onSelect} />
      <SensorBoard id="sensor.sps30.outdoor" label="SPS30 · PM1–PM10" position={[outdoorCenter[0] - 0.08, outdoorCenter[1] - 0.20, outdoorCenter[2] + 0.15]} selectedId={selectedId} mode={mode} online={outdoorParticlesOnline} size={[0.42, 0.18, 0.39]} onSelect={onSelect} />
      <Label position={[outdoorCenter[0], outdoorCenter[1] + 0.68, outdoorCenter[2] + 0.1]} size={0.07}>НАРУЖНЫЙ УЗЕЛ · IP-ЭКРАН</Label>
      <mesh position={[outdoorCenter[0], outdoorCenter[1] - 0.54, outdoorCenter[2] + 0.02]}><cylinderGeometry args={[0.035, 0.035, 0.18, 12]} /><meshStandardMaterial color="#405c60" metalness={0.3} /></mesh>
      {/* Wall pass-through between indoor controller and outdoor sensors */}
      <mesh position={[outdoorCenter[0] - 0.38, outdoorCenter[1] - 0.44, outdoorBack + 0.02]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.042, 0.042, 0.10, 16]} /><meshStandardMaterial color="#344e53" metalness={0.35} /></mesh>

      {/* DIN cabinet on the interior wall. Components are separate selectable devices. */}
      <mesh position={cabinetCenter} castShadow>
        <boxGeometry args={[cabinetWidth, cabinetHeight, 0.14]} />
        <meshStandardMaterial color="#647677" roughness={0.75} metalness={0.08} />
      </mesh>
      <mesh position={[cabinetCenter[0], cabinetCenter[1], cabinetCenter[2] + 0.09]}>
        <boxGeometry args={[cabinetWidth - 0.10, cabinetHeight - 0.11, 0.035]} />
        <meshStandardMaterial color="#e2e8de" roughness={0.78} />
      </mesh>
      <Label position={[cabinetCenter[0], cabinetCenter[1] + cabinetHeight / 2 + 0.12, frontZ]}>ШКАФ УПРАВЛЕНИЯ · 12 V DC</Label>
      {cabinetDevices.map((part) => (
        <Pickable
          key={part.id}
          id={part.id}
          position={[cabinetCenter[0] + part.x, powerY + part.z, frontZ + 0.09]}
          bounds={[part.w, part.h, 0.12]}
          selectedId={selectedId}
          mode={mode}
          onSelect={onSelect}
        >
          <mesh castShadow>
            <boxGeometry args={[part.w, part.h, 0.075]} />
            <meshStandardMaterial color={part.color} roughness={0.62} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.04]}>
            <boxGeometry args={[part.w * 0.68, part.h * 0.48, 0.015]} />
            <meshStandardMaterial color={part.id === 'power.psu_12v' ? '#9eaaa1' : '#c6d6cb'} roughness={0.5} />
          </mesh>
          {part.id === 'device.esp32' ? <mesh position={[part.w * 0.15, 0, 0.053]}><boxGeometry args={[0.18, 0.12, 0.012]} /><meshStandardMaterial color="#c2c9bf" metalness={0.52} /></mesh> : null}
          {part.id === 'power.dc_dc' ? <mesh position={[-part.w * 0.12, 0, 0.055]}><cylinderGeometry args={[0.04, 0.04, 0.04, 12]} /><meshStandardMaterial color="#a68e4d" metalness={0.24} /></mesh> : null}
          {part.id === 'power.terminal_blocks' ? <group>{Array.from({ length: 8 }, (_, index) => <mesh key={index} position={[-part.w * 0.44 + index * part.w * 0.125, 0, 0.06]}><boxGeometry args={[0.10, part.h * 0.60, 0.04]} /><meshStandardMaterial color={index < 3 ? '#c98743' : index < 6 ? '#559277' : '#537eb2'} /></mesh>)}</group> : null}
          <Label position={[0, -part.h * 0.72, 0.055]} size={part.id === 'power.terminal_blocks' ? 0.046 : 0.051} color="#243a3c">{part.label}</Label>
        </Pickable>
      ))}
      <mesh position={[cabinetCenter[0], cabinetCenter[1], frontZ + 0.04]}><boxGeometry args={[cabinetWidth - 0.18, 0.035, 0.08]} /><meshStandardMaterial color="#627575" /></mesh>
      <mesh position={[cabinetCenter[0], cabinetCenter[1] - cabinetHeight / 2 + 0.08, frontZ + 0.03]}><boxGeometry args={[cabinetWidth - 0.20, 0.11, 0.06]} /><meshStandardMaterial color="#576b6f" /></mesh>
    </group>
  )
}
