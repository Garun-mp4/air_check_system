'use client'

import { Text } from '@react-three/drei'
import type { CutawayMode, SimulatorSnapshot, VisualizationMode } from '../types'
import { Pickable } from './Pickable'
import { CylinderBetween, Fastener, Housing, StatusLed } from './models/parts'
import {
  WINDOW_ACTUATOR_WIRE_OFFSETS,
  WINDOW_LIMIT_CONTACT_OFFSETS,
  WINDOW_OPEN_LIMIT_SWITCH_SIZE,
  WINDOW_REED_CONTACT_OFFSETS,
  windowAssemblyGeometry,
} from './models/geometry'

type Point3 = [number, number, number]

const GLASS_PANE_SIZE_INSET_M = 0.095
const GLASS_PANE_THICKNESS_M = 0.006
const GLASS_PANE_OFFSETS_Z_M = [0.004, 0.022] as const

function rotateAboutBottom(point: Point3, angle: number): Point3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [point[0], point[1] * cosine - point[2] * sine, point[1] * sine + point[2] * cosine]
}

function DirectionTag({ children, position }: { children: string; position: Point3 }) {
  return <Text position={position} fontSize={0.035} color="#506568" anchorX="center" anchorY="middle" outlineWidth={0.002} outlineColor="#edf1e9">{children}</Text>
}

export default function WindowAssembly({
  snapshot,
  selectedId,
  mode,
  cutaway: _cutaway,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  cutaway?: CutawayMode
  onSelect: (id: string, point: Point3) => void
}) {
  const { room_dimensions: d } = snapshot.simulation
  const width = d.window_width_m
  const height = d.window_height_m
  const wallCenterZ = d.depth_m / 2
  const sill = d.window_sill_height_m
  const geometry = windowAssemblyGeometry(d)
  const { sashWidth, sashHeight } = geometry
  const frameWidth = 0.075
  const { sashPlaneZ, openingAngle } = geometry
  const sashAngle = openingAngle * snapshot.window.actual_position_percent / 100
  const motorMoving = snapshot.window.motor_state === 'opening' || snapshot.window.motor_state === 'closing'

  const magnetLocal = geometry.magnetLocal
  const actuatorBase = geometry.actuatorBase
  const actuatorPinLocal = rotateAboutBottom([sashWidth * 0.26, sashHeight * 0.39, 0.016], sashAngle)
  const actuatorVector: Point3 = [
    actuatorPinLocal[0] - actuatorBase[0],
    actuatorPinLocal[1] - actuatorBase[1],
    actuatorPinLocal[2] - actuatorBase[2],
  ]
  const actuatorLength = Math.hypot(...actuatorVector)
  const actuatorMidpoint: Point3 = [
    (actuatorBase[0] + actuatorPinLocal[0]) / 2,
    (actuatorBase[1] + actuatorPinLocal[1]) / 2,
    (actuatorBase[2] + actuatorPinLocal[2]) / 2,
  ]
  const actuatorBodyEnd: Point3 = [
    actuatorBase[0] + actuatorVector[0] * 0.68,
    actuatorBase[1] + actuatorVector[1] * 0.68,
    actuatorBase[2] + actuatorVector[2] * 0.68,
  ]

  return (
    <group position={[0, sill, wallCenterZ]}>
      {/* Recessed aluminum frame, compression gasket, sill and weather/drip caps. */}
      <Housing position={[-width / 2 - frameWidth / 2, height / 2, 0]} size={[frameWidth, height + frameWidth * 2, d.wall_thickness_m + 0.07]} color="#758181" radius={0.012} metalness={0.52} roughness={0.38} />
      <Housing position={[width / 2 + frameWidth / 2, height / 2, 0]} size={[frameWidth, height + frameWidth * 2, d.wall_thickness_m + 0.07]} color="#758181" radius={0.012} metalness={0.52} roughness={0.38} />
      <Housing position={[0, height + frameWidth / 2, 0]} size={[width + frameWidth * 2, frameWidth, d.wall_thickness_m + 0.07]} color="#758181" radius={0.012} metalness={0.52} roughness={0.38} />
      <Housing position={[0, -frameWidth / 2, 0]} size={[width + frameWidth * 2 + 0.07, frameWidth, d.wall_thickness_m + 0.10]} color="#8c9893" radius={0.014} metalness={0.42} roughness={0.48} />
      <Housing position={[0, -0.086, -d.wall_thickness_m / 2 - 0.063]} size={[width + 0.17, 0.027, 0.12]} color="#d1d5ce" radius={0.008} roughness={0.62} />
      <Housing position={[0, -0.105, d.wall_thickness_m / 2 + 0.045]} size={[width + 0.12, 0.019, 0.11]} color="#87938e" radius={0.006} metalness={0.22} />

      {/* A single bottom-hinged sash opens outwards, matching the linear actuator's travel. */}
      <group position={[0, 0, sashPlaneZ]} rotation={[sashAngle, 0, 0]}>
        <Pickable id="window.assembly" position={[0, 0, 0.030]} highlightPosition={[0, sashHeight / 2, 0]} bounds={[sashWidth + 0.02, sashHeight + 0.025, 0.11]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          {GLASS_PANE_OFFSETS_Z_M.map((offsetZ, index) => <mesh key={offsetZ} position={[0, sashHeight / 2, offsetZ]} castShadow={index === 0}>
            <boxGeometry args={[sashWidth - GLASS_PANE_SIZE_INSET_M, sashHeight - GLASS_PANE_SIZE_INSET_M, GLASS_PANE_THICKNESS_M]} />
            <meshPhysicalMaterial
              color={index === 0 ? '#acd4df' : '#c6e2e8'}
              transparent
              opacity={index === 0 ? 0.40 : 0.20}
              roughness={index === 0 ? 0.12 : 0.10}
              metalness={index === 0 ? 0.06 : 0.02}
              clearcoat={index === 0 ? 0.8 : 0}
              clearcoatRoughness={0.10}
              depthWrite={false}
              side={2}
            />
          </mesh>)}
          {/* Four hollow aluminum profiles form the moving frame around the glazing. */}
          <Housing position={[-sashWidth / 2 + 0.024, sashHeight / 2, 0.020]} size={[0.048, sashHeight, 0.060]} color="#617174" radius={0.009} metalness={0.48} roughness={0.42} />
          <Housing position={[sashWidth / 2 - 0.024, sashHeight / 2, 0.020]} size={[0.048, sashHeight, 0.060]} color="#617174" radius={0.009} metalness={0.48} roughness={0.42} />
          <Housing position={[0, 0.024, 0.020]} size={[sashWidth, 0.048, 0.060]} color="#617174" radius={0.009} metalness={0.48} roughness={0.42} />
          <Housing position={[0, sashHeight - 0.024, 0.020]} size={[sashWidth, 0.048, 0.060]} color="#617174" radius={0.009} metalness={0.48} roughness={0.42} />
          <Housing position={[0, sashHeight / 2, 0.038]} size={[sashWidth - 0.088, 0.007, 0.010]} color="#2f3f42" radius={0.002} />
          <Housing position={[0, sashHeight / 2, -0.006]} size={[sashWidth - 0.088, 0.007, 0.010]} color="#2f3f42" radius={0.002} />
          <Housing position={[0.014, 0.071, 0.066]} size={[0.075, 0.018, 0.030]} color="#8e9a95" radius={0.005} metalness={0.54} />
          <Housing position={[0.014, 0.116, 0.071]} size={[0.014, 0.081, 0.014]} color="#c0c9c4" radius={0.006} metalness={0.7} />
          <mesh position={[0.014, 0.153, 0.078]} rotation={[0, 0, -0.45]}><boxGeometry args={[0.014, 0.055, 0.012]} /><meshStandardMaterial color="#b6c1bc" metalness={0.68} roughness={0.32} /></mesh>
        </Pickable>
      {/* The sash magnet meets a reed switch mounted on the fixed right jamb when closed. */}
        <Pickable id="window.magnet" position={magnetLocal} bounds={[0.05, 0.04, 0.04]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <Housing position={[0, 0, 0]} size={[0.023, 0.012, 0.012]} color="#323d40" radius={0.003} metalness={0.22} />
        </Pickable>
      </group>

      {/* Bottom hinge axis and three stainless hinge leaves. */}
      <CylinderBetween from={[-sashWidth * 0.42, 0.014, sashPlaneZ - 0.038]} to={[sashWidth * 0.42, 0.014, sashPlaneZ - 0.038]} radius={0.009} color="#9aa6a2" segments={16} />
      {[-sashWidth * 0.34, 0, sashWidth * 0.34].map((x) => (
        <group key={x}>
          <Housing position={[x, 0.025, sashPlaneZ - 0.047]} size={[0.12, 0.042, 0.014]} color="#8d9994" radius={0.004} metalness={0.62} />
          <Housing position={[x, 0.025, sashPlaneZ + 0.027]} size={[0.12, 0.042, 0.014]} color="#8d9994" radius={0.004} metalness={0.62} />
          <Fastener position={[x - 0.038, 0.025, sashPlaneZ - 0.032]} scale={0.52} facing={-1} />
          <Fastener position={[x + 0.038, 0.025, sashPlaneZ + 0.018]} scale={0.52} facing={-1} />
        </group>
      ))}

      {/* Fixed linear-actuator base, telescoping rod, clevis pins and the moving sash bracket. */}
      <Pickable id="window.actuator" position={actuatorMidpoint} bounds={[0.14, 0.16, actuatorLength + 0.11]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <CylinderBetween from={[actuatorBase[0] - actuatorMidpoint[0], actuatorBase[1] - actuatorMidpoint[1], actuatorBase[2] - actuatorMidpoint[2]]} to={[actuatorBodyEnd[0] - actuatorMidpoint[0], actuatorBodyEnd[1] - actuatorMidpoint[1], actuatorBodyEnd[2] - actuatorMidpoint[2]]} radius={0.025} color="#5d696c" segments={16} metalness={0.38} />
        <CylinderBetween from={[actuatorBodyEnd[0] - actuatorMidpoint[0], actuatorBodyEnd[1] - actuatorMidpoint[1], actuatorBodyEnd[2] - actuatorMidpoint[2]]} to={[actuatorPinLocal[0] - actuatorMidpoint[0], actuatorPinLocal[1] - actuatorMidpoint[1], actuatorPinLocal[2] - actuatorMidpoint[2]]} radius={0.010} color="#c2cbc7" segments={12} metalness={0.78} />
        <Housing position={[actuatorBase[0] - actuatorMidpoint[0], actuatorBase[1] - actuatorMidpoint[1], actuatorBase[2] - actuatorMidpoint[2]]} size={[0.13, 0.075, 0.085]} color="#6c7a7c" radius={0.010} metalness={0.28} />
        {WINDOW_ACTUATOR_WIRE_OFFSETS.map((offset, index) => <mesh
          key={index}
          position={[actuatorBase[0] - actuatorMidpoint[0] + offset[0], actuatorBase[1] - actuatorMidpoint[1] + offset[1], actuatorBase[2] - actuatorMidpoint[2] + offset[2]]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.006, 0.006, 0.012, 8]} />
          <meshStandardMaterial color={index === 0 ? '#b65a4e' : '#3d494b'} metalness={0.34} roughness={0.4} />
        </mesh>)}
        <CylinderBetween from={[actuatorBase[0] - actuatorMidpoint[0], actuatorBase[1] - actuatorMidpoint[1] - 0.025, actuatorBase[2] - actuatorMidpoint[2]]} to={[actuatorBase[0] - actuatorMidpoint[0], actuatorBase[1] - actuatorMidpoint[1] + 0.025, actuatorBase[2] - actuatorMidpoint[2]]} radius={0.009} color="#aeb9b5" segments={12} />
        <CylinderBetween from={[actuatorPinLocal[0] - actuatorMidpoint[0] - 0.035, actuatorPinLocal[1] - actuatorMidpoint[1], actuatorPinLocal[2] - actuatorMidpoint[2]]} to={[actuatorPinLocal[0] - actuatorMidpoint[0] + 0.035, actuatorPinLocal[1] - actuatorMidpoint[1], actuatorPinLocal[2] - actuatorMidpoint[2]]} radius={0.008} color="#aeb9b5" segments={12} />
        <Housing position={[0, 0, -actuatorLength * 0.20]} size={[0.024, 0.024, 0.022]} color={motorMoving ? '#e4a23c' : '#3b9b7c'} radius={0.006} />
      </Pickable>

      {/* Reed switch closes at the parked sash and changes with the live Device Layer state. */}
      <Pickable id="window.reed_switch" position={geometry.reedCenter} bounds={[0.085, 0.060, 0.050]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <Housing position={[0, 0, 0]} size={[0.070, 0.045, 0.027]} color="#e0e5de" radius={0.006} />
        <Housing position={[0.006, 0.004, 0.016]} size={[0.032, 0.010, 0.004]} color="#68787a" radius={0.003} />
        <StatusLed position={[0.033, 0.020, 0.018]} active={snapshot.window.reed_switch} size={0.005} />
        {WINDOW_REED_CONTACT_OFFSETS.map((contact, index) => (
          <group key={index}>
            <mesh position={contact}>
              <cylinderGeometry args={[0.0022, 0.0022, 0.008, 8]} />
              <meshStandardMaterial color="#c2a55b" metalness={0.72} roughness={0.3} />
            </mesh>
            <CylinderBetween
              from={[contact[0], contact[1] + 0.008, contact[2]]}
              to={contact}
              radius={0.0018}
              color={index === 0 ? '#bd574d' : '#394648'}
              segments={6}
              metalness={0.12}
            />
          </group>
        ))}
      </Pickable>

      {/* The open limit is fixed to a small bracket on the stationary actuator base. */}
      <Housing position={geometry.openLimitBracketCenter} size={geometry.openLimitBracketSize} color="#8d9994" radius={0.003} metalness={0.62} roughness={0.38} />
      {geometry.openLimitBracketFasteners.map(([x, y, z], index) => (
        <group key={`open-limit-fastener-${index}`}>
          <mesh position={[x, y, z]} castShadow>
            <cylinderGeometry args={[0.0045, 0.0045, 0.003, 12]} />
            <meshStandardMaterial color="#c2cbc7" metalness={0.72} roughness={0.3} />
          </mesh>
          <mesh position={[x, y + 0.002, z]}>
            <boxGeometry args={[0.005, 0.0007, 0.001]} />
            <meshStandardMaterial color="#536164" metalness={0.42} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <Pickable id="window.limit_open" position={geometry.openLimitCenter} bounds={WINDOW_OPEN_LIMIT_SWITCH_SIZE} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <Housing position={[0, 0, 0]} size={WINDOW_OPEN_LIMIT_SWITCH_SIZE} color="#495a5d" radius={0.006} />
        <CylinderBetween from={[-0.005, 0.012, -0.016]} to={[-0.045, 0.027, -0.016]} radius={0.003} color="#c4ceca" segments={8} />
        <mesh position={[-0.047, 0.028, -0.016]}>
          <sphereGeometry args={[0.006, 10, 8]} />
          <meshStandardMaterial color="#657275" metalness={0.62} roughness={0.36} />
        </mesh>
        <StatusLed position={[0.032, 0.026, 0.018]} active={snapshot.window.open_limit_switch} size={0.005} />
        {WINDOW_LIMIT_CONTACT_OFFSETS.map(([x, y, z], index) => <mesh key={index} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0022, 0.0022, 0.006, 8]} />
          <meshStandardMaterial color="#c2a55b" metalness={0.72} roughness={0.3} />
        </mesh>)}
      </Pickable>
      <Pickable id="window.limit_close" position={geometry.closeLimitCenter} bounds={[0.075, 0.065, 0.055]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <Housing position={[0, 0, 0]} size={[0.061, 0.047, 0.029]} color="#495a5d" radius={0.006} />
        <CylinderBetween from={[0, 0.005, 0.010]} to={[0, 0.030, 0.010]} radius={0.005} color="#c4ceca" segments={8} />
        <StatusLed position={[0.032, 0.026, 0.018]} active={snapshot.window.close_limit_switch} size={0.005} />
        {WINDOW_LIMIT_CONTACT_OFFSETS.map(([x, y, z], index) => <mesh key={index} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0022, 0.0022, 0.006, 8]} />
          <meshStandardMaterial color="#c2a55b" metalness={0.72} roughness={0.3} />
        </mesh>)}
      </Pickable>

      {/* Wall anchors and latches hold the frame in the opening rather than floating in front of it. */}
      {[-1, 1].flatMap((side) => [0.16, height * 0.48, height - 0.16].map((y) => (
        <Fastener key={`${side}-${y}`} position={[side * (width / 2 + frameWidth * 0.45), y, -(d.wall_thickness_m + 0.07) / 2 - 0.003]} scale={0.72} facing={-1} />
      )))}
      <StatusLed position={[0.070, 0.086, -d.wall_thickness_m / 2 - 0.104]} active={!motorMoving} size={0.006} />
      <DirectionTag position={[0, height + frameWidth + 0.105, -d.wall_thickness_m / 2 - 0.030]}>ПОВОРОТНАЯ СТВОРКА · 12 V</DirectionTag>
      {mode === 'technical' ? <DirectionTag position={[0, -0.19, -d.wall_thickness_m / 2 - 0.18]}>{`ОТКРЫТИЕ ${snapshot.window.actual_position_percent.toFixed(0)}% · ${snapshot.window.motor_state.toUpperCase()}`}</DirectionTag> : null}
    </group>
  )
}
