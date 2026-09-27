'use client'

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'

import type { FanState, SimulatorSnapshot, VisualizationMode } from '../types'
import { Pickable } from './Pickable'

function FanRotor({ enabled }: { enabled: boolean }) {
  const rotor = useRef<Mesh>(null)
  useFrame((_, delta) => {
    if (enabled && rotor.current) rotor.current.rotation.z -= delta * 7.5
  })
  return (
    <group ref={rotor}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.055, 0.055, 0.04, 16]} /><meshStandardMaterial color="#d2d9d5" metalness={0.55} roughness={0.35} /></mesh>
      {[0, 1, 2, 3].map((blade) => (
        <mesh key={blade} rotation={[0, 0, blade * Math.PI / 2]} position={[0, 0, 0.006]}>
          <boxGeometry args={[0.075, 0.28, 0.035]} />
          <meshStandardMaterial color="#aebdb9" metalness={0.35} roughness={0.46} />
        </mesh>
      ))}
    </group>
  )
}

function Fan({
  id,
  state,
  position,
  selectedId,
  mode,
  onSelect,
}: {
  id: 'fan.intake' | 'fan.exhaust'
  state: FanState
  position: [number, number, number]
  selectedId: string | null
  mode: VisualizationMode
  onSelect: (id: string, point: [number, number, number]) => void
}) {
  return (
    <Pickable id={id} position={position} bounds={[0.78, 0.7, 0.42]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
      <mesh castShadow><boxGeometry args={[0.68, 0.58, 0.3]} /><meshStandardMaterial color="#8fa4a0" roughness={0.62} metalness={0.22} /></mesh>
      <mesh position={[0, 0, 0.17]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.235, 0.235, 0.09, 32]} /><meshStandardMaterial color="#485f65" metalness={0.34} roughness={0.45} /></mesh>
      <mesh position={[0, 0, 0.23]}><torusGeometry args={[0.18, 0.018, 8, 28]} /><meshStandardMaterial color="#c8d4d0" metalness={0.45} roughness={0.32} /></mesh>
      <group position={[0, 0, 0.235]}><FanRotor enabled={state.enabled} /></group>
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index} position={[0, 0, 0.239]} rotation={[0, 0, index * Math.PI / 4]}>
          <boxGeometry args={[0.014, 0.37, 0.025]} />
          <meshStandardMaterial color="#d9e1dd" metalness={0.35} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0.17, 0.22, 0.16]}>
        <sphereGeometry args={[0.045, 12, 8]} />
        <meshStandardMaterial color={state.enabled ? '#24a77d' : '#7c8b88'} emissive={state.enabled ? '#13563f' : '#000000'} />
      </mesh>
      {mode === 'technical' ? <mesh position={[0, -0.37, 0]}><boxGeometry args={[0.38, 0.03, 0.025]} /><meshStandardMaterial color={state.enabled ? '#2aa882' : '#87938f'} /></mesh> : null}
    </Pickable>
  )
}

export default function FanAssembly({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  onSelect: (id: string, point: [number, number, number]) => void
}) {
  const { width_m, height_m, depth_m, wall_thickness_m } = snapshot.simulation.room_dimensions
  const z = depth_m / 2 - wall_thickness_m / 2 - 0.20
  const y = height_m * 0.81
  return (
    <group>
      <Fan id="fan.intake" state={snapshot.ventilation.intake} position={[-width_m * 0.37, y, z]} selectedId={selectedId} mode={mode} onSelect={onSelect} />
      <Fan id="fan.exhaust" state={snapshot.ventilation.exhaust} position={[width_m * 0.37, y, z]} selectedId={selectedId} mode={mode} onSelect={onSelect} />
      <mesh position={[-width_m * 0.37, y - 0.37, z - 0.02]}>
        <boxGeometry args={[0.58, 0.045, 0.04]} />
        <meshStandardMaterial color="#657579" />
      </mesh>
      <mesh position={[width_m * 0.37, y - 0.37, z - 0.02]}>
        <boxGeometry args={[0.58, 0.045, 0.04]} />
        <meshStandardMaterial color="#657579" />
      </mesh>
    </group>
  )
}
