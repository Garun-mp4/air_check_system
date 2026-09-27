'use client'

import type { CutawayMode, SimulatorSnapshot, VisualizationMode } from '../types'
import { Pickable } from './Pickable'

export default function WindowAssembly({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  cutaway?: CutawayMode
  onSelect: (id: string, point: [number, number, number]) => void
}) {
  const { room_dimensions: d } = snapshot.simulation
  const width = d.window_width_m
  const height = d.window_height_m
  const sill = d.window_sill_height_m
  const wallZ = d.depth_m / 2 + d.wall_thickness_m / 2 + 0.06
  const centerY = sill + height / 2
  const frameDepth = 0.13
  const frameColor = '#506d74'
  const glass = '#8ac8db'
  const sashAngle = -d.window_open_angle_degrees * Math.PI / 180 * snapshot.window.actual_position_percent / 100
  const sashRatio = snapshot.window.actual_position_percent / 100

  return (
    <group>
      <group position={[0, centerY, wallZ]}>
        <mesh position={[-width / 2, 0, 0]} castShadow><boxGeometry args={[0.09, height + 0.12, frameDepth]} /><meshStandardMaterial color={frameColor} metalness={0.35} roughness={0.4} /></mesh>
        <mesh position={[width / 2, 0, 0]} castShadow><boxGeometry args={[0.09, height + 0.12, frameDepth]} /><meshStandardMaterial color={frameColor} metalness={0.35} roughness={0.4} /></mesh>
        <mesh position={[0, -height / 2, 0]} castShadow><boxGeometry args={[width + 0.1, 0.09, frameDepth]} /><meshStandardMaterial color={frameColor} metalness={0.3} roughness={0.45} /></mesh>
        <mesh position={[0, height / 2, 0]} castShadow><boxGeometry args={[width + 0.1, 0.09, frameDepth]} /><meshStandardMaterial color={frameColor} metalness={0.3} roughness={0.45} /></mesh>
        <mesh position={[0, 0, -0.012]}><boxGeometry args={[0.055, height, 0.05]} /><meshStandardMaterial color="#68868a" metalness={0.25} roughness={0.5} /></mesh>
        <mesh position={[0, -height / 2 - 0.095, 0.015]} castShadow><boxGeometry args={[width + 0.24, 0.1, 0.24]} /><meshStandardMaterial color="#d6e0dd" roughness={0.6} /></mesh>

        <group position={[-width / 2, 0, -0.015]} rotation={[0, sashAngle, 0]}>
          <Pickable
            id="window.assembly"
            position={[width / 2, 0, 0.035]}
            bounds={[width + 0.04, height + 0.03, 0.09]}
            selectedId={selectedId}
            mode={mode}
            onSelect={onSelect}
          >
            <mesh castShadow><boxGeometry args={[width, height, 0.065]} /><meshStandardMaterial color={glass} transparent opacity={0.58} roughness={0.18} metalness={0.12} /></mesh>
            <mesh position={[0, height / 2, 0]}><boxGeometry args={[width, 0.05, 0.1]} /><meshStandardMaterial color="#536d73" metalness={0.3} roughness={0.4} /></mesh>
            <mesh position={[0, -height / 2, 0]}><boxGeometry args={[width, 0.05, 0.1]} /><meshStandardMaterial color="#536d73" metalness={0.3} roughness={0.4} /></mesh>
            <mesh position={[-width / 2, 0, 0]}><boxGeometry args={[0.05, height, 0.1]} /><meshStandardMaterial color="#536d73" metalness={0.3} roughness={0.4} /></mesh>
            <mesh position={[width / 2, 0, 0]}><boxGeometry args={[0.05, height, 0.1]} /><meshStandardMaterial color="#536d73" metalness={0.3} roughness={0.4} /></mesh>
          </Pickable>
        </group>

        <Pickable id="window.reed_switch" position={[width / 2 - 0.14, height / 2 - 0.18, 0.1]} bounds={[0.22, 0.16, 0.12]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <mesh castShadow><boxGeometry args={[0.18, 0.09, 0.09]} /><meshStandardMaterial color={snapshot.window.reed_switch ? '#22a985' : '#e3a23b'} roughness={0.45} /></mesh>
          <mesh position={[-0.18, 0, 0.015]}><boxGeometry args={[0.075, 0.065, 0.07]} /><meshStandardMaterial color="#66777a" roughness={0.55} /></mesh>
        </Pickable>

        <Pickable id="window.actuator" position={[0.03, -height / 2 + 0.14, 0.15]} bounds={[width * 0.55, 0.2, 0.18]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <mesh position={[-width * 0.12, -0.035, 0]} castShadow><boxGeometry args={[width * 0.48, 0.13, 0.15]} /><meshStandardMaterial color="#64777a" metalness={0.52} roughness={0.38} /></mesh>
          <mesh position={[width * (0.15 + 0.12 * sashRatio), 0.01, 0.015]} castShadow><boxGeometry args={[width * 0.3, 0.035, 0.045]} /><meshStandardMaterial color="#a3b2ad" metalness={0.6} roughness={0.3} /></mesh>
          <mesh position={[-width * 0.12, 0.055, 0.086]}><boxGeometry args={[0.07, 0.035, 0.012]} /><meshStandardMaterial color={snapshot.window.motor_state === 'stopped' ? '#2c9f7b' : '#e0a540'} emissive={snapshot.window.motor_state === 'stopped' ? '#145840' : '#704300'} /></mesh>
        </Pickable>

        <Pickable id="window.limit_open" position={[width / 2 - 0.14, -height / 2 + 0.15, 0.1]} bounds={[0.16, 0.12, 0.1]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <mesh><boxGeometry args={[0.12, 0.075, 0.08]} /><meshStandardMaterial color={snapshot.window.open_limit_switch ? '#20a884' : '#7e8b89'} emissive={snapshot.window.open_limit_switch ? '#0d5d47' : '#000000'} /></mesh>
        </Pickable>
        <Pickable id="window.limit_close" position={[-width / 2 + 0.14, -height / 2 + 0.15, 0.1]} bounds={[0.16, 0.12, 0.1]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <mesh><boxGeometry args={[0.12, 0.075, 0.08]} /><meshStandardMaterial color={snapshot.window.close_limit_switch ? '#20a884' : '#7e8b89'} emissive={snapshot.window.close_limit_switch ? '#0d5d47' : '#000000'} /></mesh>
        </Pickable>
      </group>
      {mode === 'technical' ? (
        <group position={[width / 2 + 0.42, centerY - height / 2 + 0.1, wallZ + 0.35]}>
          <mesh><sphereGeometry args={[0.04, 10, 8]} /><meshBasicMaterial color={snapshot.window.reed_switch ? '#16a77d' : '#d7932f'} /></mesh>
        </group>
      ) : null}
    </group>
  )
}
