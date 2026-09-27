'use client'

import { useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import { Quaternion, Vector3 } from 'three'

export type Point3 = [number, number, number]

export function Housing({
  position,
  size,
  color,
  radius = 0.012,
  roughness = 0.72,
  metalness = 0.04,
  castShadow = true,
}: {
  position: Point3
  size: Point3
  color: string
  radius?: number
  roughness?: number
  metalness?: number
  castShadow?: boolean
}) {
  return (
    <RoundedBox position={position} args={size} radius={radius} smoothness={2} castShadow={castShadow} receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </RoundedBox>
  )
}

export function CylinderBetween({
  from,
  to,
  radius,
  color,
  segments = 12,
  metalness = 0.48,
}: {
  from: Point3
  to: Point3
  radius: number
  color: string
  segments?: number
  metalness?: number
}) {
  const { position, rotation, length } = useMemo(() => {
    const start = new Vector3(...from)
    const end = new Vector3(...to)
    const direction = end.clone().sub(start)
    const length = direction.length()
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
    return { position: start.add(end).multiplyScalar(0.5), rotation, length }
  }, [from[0], from[1], from[2], to[0], to[1], to[2]])

  if (length < 0.001) return null
  return (
    <mesh position={position} quaternion={rotation} castShadow>
      <cylinderGeometry args={[radius, radius, length, segments]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={0.34} />
    </mesh>
  )
}

export function Fastener({ position, scale = 1, color = '#aab5b3', facing = 1 }: { position: Point3; scale?: number; color?: string; facing?: 1 | -1 }) {
  return (
    <group position={position} rotation={[facing * Math.PI / 2, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.008 * scale, 0.008 * scale, 0.003 * scale, 12]} />
        <meshStandardMaterial color={color} metalness={0.72} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, facing * 0.0018 * scale]}>
        <boxGeometry args={[0.009 * scale, 0.0012 * scale, 0.001 * scale]} />
        <meshStandardMaterial color="#48585b" metalness={0.44} roughness={0.45} />
      </mesh>
    </group>
  )
}

export function StatusLed({ position, active, size = 0.009 }: { position: Point3; active: boolean; size?: number }) {
  const color = active ? '#30c58d' : '#d17848'
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 12, 8]} />
      <meshStandardMaterial color={color} emissive={active ? '#146445' : '#542412'} emissiveIntensity={active ? 0.8 : 0.35} roughness={0.25} />
    </mesh>
  )
}

export function VentSlats({
  width,
  count,
  y = 0,
  z,
  color = '#768789',
  thickness = 0.004,
}: {
  width: number
  count: number
  y: number
  z: number
  color?: string
  thickness?: number
}) {
  return (
    <group>
      {Array.from({ length: count }, (_, index) => (
        <mesh key={index} position={[0, y + (index - (count - 1) / 2) * 0.014, z]} castShadow>
          <boxGeometry args={[width, thickness, 0.006]} />
          <meshStandardMaterial color={color} metalness={0.18} roughness={0.55} />
        </mesh>
      ))}
    </group>
  )
}

export function MountingScrews({
  width,
  height,
  z,
  inset = 0.035,
  facing = 1,
}: {
  width: number
  height: number
  z: number
  inset?: number
  facing?: 1 | -1
}) {
  return (
    <group>
      {[-1, 1].flatMap((xSide) => [-1, 1].map((ySide) => (
        <Fastener key={`${xSide}-${ySide}`} position={[xSide * (width / 2 - inset), ySide * (height / 2 - inset), z]} facing={facing} />
      )))}
    </group>
  )
}
