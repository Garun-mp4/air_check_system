'use client'

import { Text } from '@react-three/drei'
import type { CutawayMode, SimulatorSnapshot, VisualizationMode } from '../types'
import { Pickable } from './Pickable'
import { CylinderBetween, Fastener, Housing, StatusLed } from './models/parts'

type Point3 = [number, number, number]

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
  const sashWidth = width - 0.07
  const sashHeight = height - 0.07
  const frameWidth = 0.075
  const sashPlaneZ = -d.wall_thickness_m / 2 - 0.022
  const openingAngle = d.window_open_angle_degrees * Math.PI / 180
  const sashAngle = openingAngle * snapshot.window.actual_position_percent / 100
  const motorMoving = snapshot.window.motor_state === 'opening' || snapshot.window.motor_state === 'closing'

  const magnetLocal: Point3 = [sashWidth * 0.31, sashHeight * 0.31, 0.038]
  const magnetWorld = rotateAboutBottom(magnetLocal, sashAngle)
  const openSwitchLocal = rotateAboutBottom([sashWidth * 0.38, sashHeight - 0.07, 0.028], openingAngle)
  const actuatorBase: Point3 = [0.0, 0.13, -d.wall_thickness_m / 2 - 0.245]
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
      <Housing position={[0, height / 2, -d.wall_thickness_m / 2 - 0.009]} size={[width + 0.11, height + 0.11, 0.024]} color="#d4d8d1" radius={0.016} />
      <Housing position={[0, height / 2, d.wall_thickness_m / 2 + 0.010]} size={[width + 0.08, height + 0.08, 0.020]} color="#d4d8d1" radius={0.014} />

      {/* A single bottom-hinged sash opens outwards, matching the linear actuator's travel. */}
      <group position={[0, 0, sashPlaneZ]} rotation={[sashAngle, 0, 0]}>
        <Pickable id="window.assembly" position={[0, 0, 0.030]} highlightPosition={[0, sashHeight / 2, 0]} bounds={[sashWidth + 0.02, sashHeight + 0.025, 0.11]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
          <mesh position={[0, sashHeight / 2, 0.010]} castShadow>
            <boxGeometry args={[sashWidth - 0.095, sashHeight - 0.095, 0.018]} />
            <meshPhysicalMaterial color="#acd4df" transparent opacity={0.40} roughness={0.12} metalness={0.06} clearcoat={0.8} clearcoatRoughness={0.10} side={2} />
          </mesh>
          <mesh position={[0, sashHeight / 2, 0.000]}>
            <boxGeometry args={[sashWidth - 0.118, sashHeight - 0.118, 0.006]} />
            <meshPhysicalMaterial color="#c6e2e8" transparent opacity={0.20} roughness={0.10} metalness={0.02} side={2} />
          </mesh>
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
        {/* Small coded magnet on the sash: its distance from the fixed reed changes with actual position. */}
        <Housing position={magnetLocal} size={[0.023, 0.012, 0.012]} color="#323d40" radius={0.003} metalness={0.22} />
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
        <CylinderBetween from={[actuatorBase[0] - actuatorMidpoint[0], actuatorBase[1] - actuatorMidpoint[1] - 0.025, actuatorBase[2] - actuatorMidpoint[2]]} to={[actuatorBase[0] - actuatorMidpoint[0], actuatorBase[1] - actuatorMidpoint[1] + 0.025, actuatorBase[2] - actuatorMidpoint[2]]} radius={0.009} color="#aeb9b5" segments={12} />
        <CylinderBetween from={[actuatorPinLocal[0] - actuatorMidpoint[0] - 0.035, actuatorPinLocal[1] - actuatorMidpoint[1], actuatorPinLocal[2] - actuatorMidpoint[2]]} to={[actuatorPinLocal[0] - actuatorMidpoint[0] + 0.035, actuatorPinLocal[1] - actuatorMidpoint[1], actuatorPinLocal[2] - actuatorMidpoint[2]]} radius={0.008} color="#aeb9b5" segments={12} />
        <Housing position={[0, 0, -actuatorLength * 0.20]} size={[0.024, 0.024, 0.022]} color={motorMoving ? '#e4a23c' : '#3b9b7c'} radius={0.006} />
      </Pickable>

      {/* Reed switch closes at the parked sash and changes with the live Device Layer state. */}
      <Pickable id="window.reed_switch" position={[sashWidth * 0.31, 0.31, sashPlaneZ + 0.032]} bounds={[0.085, 0.060, 0.050]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <Housing position={[0, 0, 0]} size={[0.070, 0.045, 0.027]} color="#e0e5de" radius={0.006} />
        <Housing position={[0.006, 0.004, 0.016]} size={[0.032, 0.010, 0.004]} color="#68787a" radius={0.003} />
        <StatusLed position={[0.033, 0.020, 0.018]} active={snapshot.window.reed_switch} size={0.005} />
        <CylinderBetween from={[-0.026, -0.012, 0.010]} to={[-0.080, -0.012, 0.010]} radius={0.0025} color="#4f6264" segments={6} metalness={0.12} />
      </Pickable>

      {/* The open limit is at the actuator-side end of travel; the close limit is on the sill. */}
      <Pickable id="window.limit_open" position={[openSwitchLocal[0], openSwitchLocal[1], sashPlaneZ + openSwitchLocal[2] + 0.04]} bounds={[0.075, 0.065, 0.055]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <Housing position={[0, 0, 0]} size={[0.061, 0.047, 0.029]} color="#495a5d" radius={0.006} />
        <CylinderBetween from={[0, -0.005, 0.010]} to={[0, -0.030, 0.010]} radius={0.005} color="#c4ceca" segments={8} />
        <StatusLed position={[0.032, 0.026, 0.018]} active={snapshot.window.open_limit_switch} size={0.005} />
      </Pickable>
      <Pickable id="window.limit_close" position={[sashWidth * 0.34, 0.040, sashPlaneZ - 0.065]} bounds={[0.075, 0.065, 0.055]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        <Housing position={[0, 0, 0]} size={[0.061, 0.047, 0.029]} color="#495a5d" radius={0.006} />
        <CylinderBetween from={[0, 0.005, 0.010]} to={[0, 0.030, 0.010]} radius={0.005} color="#c4ceca" segments={8} />
        <StatusLed position={[0.032, 0.026, 0.018]} active={snapshot.window.close_limit_switch} size={0.005} />
      </Pickable>

      {/* Wall anchors and latches hold the frame in the opening rather than floating in front of it. */}
      {[-1, 1].flatMap((side) => [0.16, height * 0.48, height - 0.16].map((y) => (
        <Fastener key={`${side}-${y}`} position={[side * (width / 2 + frameWidth * 0.45), y, -d.wall_thickness_m / 2 - 0.015]} scale={0.72} facing={-1} />
      )))}
      <StatusLed position={[0.070, 0.086, -d.wall_thickness_m / 2 - 0.104]} active={!motorMoving} size={0.006} />
      <DirectionTag position={[0, height + frameWidth + 0.105, -d.wall_thickness_m / 2 - 0.030]}>ПОВОРОТНАЯ СТВОРКА · 12 V</DirectionTag>
      {mode === 'technical' ? <DirectionTag position={[0, -0.19, -d.wall_thickness_m / 2 - 0.18]}>{`ОТКРЫТИЕ ${snapshot.window.actual_position_percent.toFixed(0)}% · ${snapshot.window.motor_state.toUpperCase()}`}</DirectionTag> : null}
      <mesh position={magnetWorld} visible={mode === 'technical'}>
        <sphereGeometry args={[0.009, 10, 8]} />
        <meshStandardMaterial color={snapshot.window.reed_switch ? '#2fa983' : '#d29a3c'} metalness={0.3} />
      </mesh>
    </group>
  )
}
