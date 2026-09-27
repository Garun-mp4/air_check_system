'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CatmullRomCurve3, Vector3 } from 'three'
import type { Mesh } from 'three'

import type { SimulatorSnapshot } from '../types'

type Point = [number, number, number]

function FlowTrack({
  points,
  volume,
  color,
  visible,
}: {
  points: Point[]
  volume: number
  color: string
  visible: boolean
}) {
  const beads = useRef<Array<Mesh | null>>([])
  const progress = useRef(Array.from({ length: 8 }, (_, index) => index / 8))
  const curve = useMemo(() => new CatmullRomCurve3(points.map((point) => new Vector3(...point))), [points])
  const geometry = useMemo(() => curve, [curve])
  useFrame((_, delta) => {
    const active = visible && volume > 0.05
    const rate = 0.18 + Math.min(0.50, volume / 120)
    for (let index = 0; index < progress.current.length; index += 1) {
      const bead = beads.current[index]
      if (!bead) continue
      bead.visible = active
      if (!active) continue
      progress.current[index] = (progress.current[index] + delta * rate) % 1
      const point = curve.getPointAt(progress.current[index])
      bead.position.copy(point)
    }
  })
  const active = visible && volume > 0.05
  return (
    <group>
      {active ? <mesh><tubeGeometry args={[geometry, 32, 0.018, 7, false]} /><meshBasicMaterial color={color} transparent opacity={0.45} /></mesh> : null}
      {progress.current.map((_, index) => (
        <mesh key={index} ref={(node) => { beads.current[index] = node }} visible={false}>
          <sphereGeometry args={[0.035, 9, 7]} />
          <meshBasicMaterial color={color} transparent opacity={0.86} />
        </mesh>
      ))}
    </group>
  )
}

export default function Airflow({ snapshot, visible }: { snapshot: SimulatorSnapshot; visible: boolean }) {
  const d = snapshot.simulation.room_dimensions
  const windowY = d.window_sill_height_m + d.window_height_m * 0.5
  const windowZ = d.depth_m / 2 + 0.1
  const intakeX = -d.width_m * 0.37
  const exhaustX = d.width_m * 0.37
  const fanY = d.height_m * 0.81
  const fanZ = d.depth_m / 2 - d.wall_thickness_m / 2 - 0.2
  return (
    <group>
      <FlowTrack visible={visible} volume={snapshot.airflow.window_m3_h} color="#2994bc" points={[[0, windowY, d.depth_m / 2 + 1.0], [0.25, windowY + 0.28, windowZ], [0.12, windowY + 0.14, d.depth_m / 2 - 0.35], [0, windowY, d.depth_m / 2 - 1.1]]} />
      <FlowTrack visible={visible} volume={snapshot.airflow.intake_m3_h} color="#1c9a84" points={[[intakeX, fanY, d.depth_m / 2 + 0.72], [intakeX, fanY, d.depth_m / 2 + 0.12], [intakeX, fanY - 0.06, fanZ], [intakeX * 0.56, fanY - 0.12, 0.2], [0, fanY - 0.32, -0.4]]} />
      <FlowTrack visible={visible} volume={snapshot.airflow.exhaust_m3_h} color="#e09343" points={[[0.4, fanY - 0.28, -0.2], [exhaustX * 0.56, fanY - 0.12, 0.2], [exhaustX, fanY - 0.05, fanZ], [exhaustX, fanY, d.depth_m / 2 + 0.18], [exhaustX, fanY, d.depth_m / 2 + 0.75]]} />
    </group>
  )
}
