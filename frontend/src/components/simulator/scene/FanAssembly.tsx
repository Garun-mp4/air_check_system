'use client'

import { useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Shape } from 'three'
import type { Mesh } from 'three'
import type { FanState, SimulatorSnapshot, VisualizationMode } from '../types'
import { Pickable } from './Pickable'
import { CylinderBetween, Fastener, Housing, StatusLed } from './models/parts'
import { EXHAUST_HOOD_HOUSING_DEPTH_M, exteriorFanCenterZ, FAN_CABLE_OFFSETS, INTAKE_FILTER_HOUSING_DEPTH_M } from './models/geometry'

type Point3 = [number, number, number]

function FanBlade({ rotation, shape }: { rotation: number; shape: Shape }) {
  return (
    <mesh rotation={[0, 0, rotation]} position={[0, 0, 0.006]}>
      <extrudeGeometry args={[shape, { depth: 0.003, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.001, bevelThickness: 0.001 }]} />
      <meshStandardMaterial color="#c4ceca" metalness={0.46} roughness={0.36} side={2} />
    </mesh>
  )
}

function FanRotor({ state }: { state: FanState }) {
  const rotor = useRef<Mesh>(null)
  const blade = useMemo(() => {
    const shape = new Shape()
    shape.moveTo(0.025, -0.011)
    shape.quadraticCurveTo(0.040, -0.035, 0.065, -0.041)
    shape.lineTo(0.094, -0.019)
    shape.quadraticCurveTo(0.073, 0.006, 0.041, 0.016)
    shape.quadraticCurveTo(0.032, 0.013, 0.025, -0.011)
    return shape
  }, [])
  const rotationSpeed = state.enabled && state.nominal_rpm > 0
    ? Math.min(25, (state.rpm / state.nominal_rpm) * 20)
    : 0
  useFrame((_, delta) => {
    if (rotor.current && rotationSpeed > 0) rotor.current.rotation.z -= delta * rotationSpeed
  })
  return (
    <group ref={rotor}>
      {[0, 1, 2, 3, 4, 5, 6].map((index) => <FanBlade key={index} shape={blade} rotation={index * Math.PI * 2 / 7} />)}
      <mesh position={[0, 0, 0.015]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.030, 0.033, 0.028, 24]} />
        <meshStandardMaterial color="#84908f" metalness={0.66} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0, 0.032]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.020, 0.006, 20]} />
        <meshStandardMaterial color="#d0d7d2" metalness={0.68} roughness={0.28} />
      </mesh>
    </group>
  )
}

function FanGrille({ z }: { z: number }) {
  return (
    <group>
      {[0.052, 0.076].map((radius) => (
        <mesh key={radius} position={[0, 0, z]}>
          <torusGeometry args={[radius, 0.0026, 6, 32]} />
          <meshStandardMaterial color="#abb6b2" metalness={0.6} roughness={0.34} />
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, index) => {
        const angle = index * Math.PI / 5
        return (
          <CylinderBetween
            key={index}
            from={[Math.cos(angle) * 0.025, Math.sin(angle) * 0.025, z]}
            to={[Math.cos(angle) * 0.079, Math.sin(angle) * 0.079, z]}
            radius={0.0022}
            color="#aeb9b5"
            segments={6}
          />
        )
      })}
      <mesh position={[0, 0, z]}>
        <torusGeometry args={[0.026, 0.0024, 6, 24]} />
        <meshStandardMaterial color="#abb6b2" metalness={0.6} roughness={0.34} />
      </mesh>
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
  exteriorZ,
}: {
  id: 'fan.intake' | 'fan.exhaust'
  state: FanState
  position: Point3
  selectedId: string | null
  mode: VisualizationMode
  onSelect: (id: string, point: Point3) => void
  exteriorZ: number
}) {
  const intake = id === 'fan.intake'
  return (
    <group>
      <Pickable id={id} position={position} bounds={[0.30, 0.30, 0.34]} selectedId={selectedId} mode={mode} onSelect={onSelect}>
        {/* The fan sits in a wall sleeve; its square frame and guard face the room. */}
        <Housing position={[0, 0, 0.030]} size={[0.205, 0.205, 0.145]} color="#516266" radius={0.012} metalness={0.28} roughness={0.54} />
        <Housing position={[0, 0, -0.052]} size={[0.225, 0.225, 0.020]} color="#69797b" radius={0.012} metalness={0.34} roughness={0.42} />
        <mesh position={[0, 0, -0.066]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.086, 0.086, 0.028, 40]} />
          <meshStandardMaterial color="#344448" metalness={0.26} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, -0.088]}>
          <torusGeometry args={[0.083, 0.009, 10, 40]} />
          <meshStandardMaterial color="#899694" metalness={0.58} roughness={0.34} />
        </mesh>
        <group position={[0, 0, -0.085]}><FanRotor state={state} /></group>
        <FanGrille z={-0.105} />
        {[-1, 1].flatMap((xSide) => [-1, 1].map((ySide) => (
          <group key={`${xSide}-${ySide}`} position={[xSide * 0.092, ySide * 0.092, -0.063]}>
            <mesh><cylinderGeometry args={[0.009, 0.009, 0.004, 12]} /><meshStandardMaterial color="#344448" metalness={0.4} /></mesh>
            <mesh position={[0, 0, 0.003]}><cylinderGeometry args={[0.004, 0.004, 0.002, 10]} /><meshStandardMaterial color="#aeb9b5" metalness={0.76} roughness={0.28} /></mesh>
          </group>
        )))}
        <Housing position={[0.084, 0.088, 0.045]} size={[0.045, 0.027, 0.039]} color="#3e4d50" radius={0.005} />
        <StatusLed position={[0.083, 0.090, 0.067]} active={state.enabled} size={0.006} />
        <Housing position={[0, -0.106, 0.048]} size={[0.055, 0.018, 0.029]} color="#49595b" radius={0.004} />
        {FAN_CABLE_OFFSETS.map(([x, y, z], index) => <mesh key={index} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0026, 0.0026, 0.006, 8]} />
          <meshStandardMaterial color={index === 0 ? '#bd574d' : '#394648'} metalness={0.58} roughness={0.32} />
        </mesh>)}
      </Pickable>

      {/* The service side is outside: intake has a removable filter cassette; exhaust has a backdraft hood. */}
      {intake ? (
        <group position={[position[0], position[1], exteriorZ]}>
          <Housing position={[0, 0, 0]} size={[0.226, 0.226, INTAKE_FILTER_HOUSING_DEPTH_M]} color="#d3d9d2" radius={0.012} metalness={0.15} roughness={0.78} />
          <Housing position={[0, 0, 0.057]} size={[0.198, 0.198, 0.018]} color="#aebdb3" radius={0.006} />
          <mesh position={[0, 0, 0.068]}>
            <boxGeometry args={[0.151, 0.151, 0.007]} />
            <meshStandardMaterial color="#d6dfd5" roughness={0.87} />
          </mesh>
          {Array.from({ length: 9 }, (_, index) => <mesh key={index} position={[0, -0.064 + index * 0.016, 0.073]}><boxGeometry args={[0.152, 0.003, 0.003]} /><meshStandardMaterial color="#8ca197" roughness={0.7} /></mesh>)}
          <Housing position={[0.105, 0, 0.009]} size={[0.036, 0.16, 0.072]} color="#72847e" radius={0.008} />
          {mode === 'technical' ? <CabinetDirectionLabel position={[0, -0.151, 0.075]}>{'G4 · ФИЛЬТР'}</CabinetDirectionLabel> : null}
          {[-1, 1].flatMap((xSide) => [-1, 1].map((ySide) => <Fastener key={`${xSide}-${ySide}`} position={[xSide * 0.095, ySide * 0.095, 0.069]} scale={0.72} />))}
        </group>
      ) : (
        <group position={[position[0], position[1], exteriorZ]}>
          <Housing position={[0, 0, 0]} size={[0.22, 0.22, EXHAUST_HOOD_HOUSING_DEPTH_M]} color="#c3cbc6" radius={0.010} metalness={0.24} roughness={0.68} />
          <Housing position={[0, 0, 0.043]} size={[0.19, 0.19, 0.018]} color="#788786" radius={0.008} metalness={0.28} />
          {[-0.045, 0, 0.045].map((y) => <mesh key={y} position={[0, y, 0.055]} rotation={[0.10, 0, 0.08]}><boxGeometry args={[0.145, 0.018, 0.012]} /><meshStandardMaterial color="#d6ddd8" metalness={0.24} roughness={0.58} /></mesh>)}
          <Housing position={[0, 0.112, 0.045]} size={[0.23, 0.034, 0.10]} color="#aab5b1" radius={0.008} />
          {mode === 'technical' ? <CabinetDirectionLabel position={[0, -0.151, 0.055]}>{'ОБРАТНЫЙ КЛАПАН'}</CabinetDirectionLabel> : null}
          {[-1, 1].flatMap((xSide) => [-1, 1].map((ySide) => <Fastener key={`${xSide}-${ySide}`} position={[xSide * 0.092, ySide * 0.092, 0.060]} scale={0.70} />))}
        </group>
      )}
      {mode === 'technical' ? <CabinetDirectionLabel position={[position[0], position[1] - 0.185, position[2] - 0.09]}>{intake ? 'СНАРУЖИ → ФИЛЬТР → КОМНАТА' : 'КОМНАТА → НАРУЖУ'}</CabinetDirectionLabel> : null}
    </group>
  )
}

function CabinetDirectionLabel({ children, position }: { children: string; position: Point3 }) {
  return <Text position={position} fontSize={0.030} color="#35474a" anchorX="center" anchorY="middle" outlineWidth={0.0018} outlineColor="#edf0e9">{children}</Text>
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
  onSelect: (id: string, point: Point3) => void
}) {
  const { width_m, height_m, depth_m, wall_thickness_m } = snapshot.simulation.room_dimensions
  const y = height_m * 0.81
  const wallInteriorFace = depth_m / 2 - wall_thickness_m / 2
  const fanDepth = wallInteriorFace - 0.11
  const fanX = width_m * 0.37
  const intakeExteriorZ = exteriorFanCenterZ(depth_m, wall_thickness_m, true)
  const exhaustExteriorZ = exteriorFanCenterZ(depth_m, wall_thickness_m, false)
  return (
    <group>
      {/* Each sleeve bridges the opening through the back wall; filter and hood remain on the exterior side. */}
      {[-fanX, fanX].map((x) => (
        <group key={x}>
          <mesh position={[x, y, depth_m / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.092, 0.092, wall_thickness_m + 0.08, 32]} />
            <meshStandardMaterial color="#85938f" metalness={0.16} roughness={0.65} />
          </mesh>
          <mesh position={[x, y, depth_m / 2 + wall_thickness_m / 2]}>
            <torusGeometry args={[0.094, 0.009, 8, 32]} />
            <meshStandardMaterial color="#a7b1ab" metalness={0.4} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <Fan id="fan.intake" state={snapshot.ventilation.intake} position={[-fanX, y, fanDepth]} selectedId={selectedId} mode={mode} onSelect={onSelect} exteriorZ={intakeExteriorZ} />
      <Fan id="fan.exhaust" state={snapshot.ventilation.exhaust} position={[fanX, y, fanDepth]} selectedId={selectedId} mode={mode} onSelect={onSelect} exteriorZ={exhaustExteriorZ} />
    </group>
  )
}
