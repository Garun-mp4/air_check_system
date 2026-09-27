'use client'

import { useMemo } from 'react'
import { CatmullRomCurve3, Vector3 } from 'three'
import type { SimulatorSnapshot } from '../types'

type Point = [number, number, number]

function curve(points: Point[]) {
  return new CatmullRomCurve3(points.map((point) => new Vector3(...point)))
}

function Conduit({ points, color, radius = 0.012 }: { points: Point[]; color: string; radius?: number }) {
  const route = useMemo(() => curve(points), [points])
  const geometry = useMemo(() => route, [route])
  return <mesh><tubeGeometry args={[geometry, 24, radius, 7, false]} /><meshStandardMaterial color={color} roughness={0.55} metalness={0.16} /></mesh>
}

export default function Wiring({ snapshot, visible }: { snapshot: SimulatorSnapshot; visible: boolean }) {
  const { room_dimensions: d, layout, mount_dimensions } = snapshot.simulation
  if (!visible) return null
  const indoor = layout.indoor_sensor_center
  const outdoor = layout.outdoor_station_center
  const cabinet = layout.control_cabinet_center
  const convert = (point: [number, number, number], zOffset = 0.08): Point => [point[0], point[2], point[1] + zOffset]
  const cabinetUpper: Point = [cabinet[0], cabinet[2] + mount_dimensions.control_cabinet_height_m * 0.40, cabinet[1] + 0.17]
  const cabinetLower: Point = [cabinet[0], cabinet[2] - mount_dimensions.control_cabinet_height_m * 0.36, cabinet[1] + 0.17]
  const upperTrunk: Point[] = [cabinetUpper, [cabinet[0], d.height_m - 0.37, layout.rear_wire_y], [0, d.height_m - 0.37, layout.rear_wire_y]]
  const indoorDrop: Point[] = [...upperTrunk, [layout.indoor_drop_x, d.height_m - 0.37, layout.rear_wire_y], [layout.indoor_drop_x, indoor[2], layout.rear_wire_y], convert(indoor)]
  const outdoorRoute: Point[] = [
    [cabinet[0] - 0.7, cabinet[2] - 0.5, layout.rear_wire_y],
    [layout.exterior_entry_x, cabinet[2] - 0.5, layout.rear_wire_y],
    [layout.exterior_entry_x, outdoor[2] - 0.45, d.depth_m / 2 + d.wall_thickness_m + 0.04],
    [outdoor[0] - 0.34, outdoor[2] - 0.45, outdoor[1] + 0.15],
    convert(outdoor),
  ]
  const fanRoute = (x: number): Point[] => [
    cabinetLower,
    [x, cabinet[2] - 0.52, layout.rear_wire_y],
    [x, d.height_m * 0.81, d.depth_m / 2 - d.wall_thickness_m / 2 - 0.2],
  ]
  const windowRoute: Point[] = [cabinetLower, [0.8, cabinet[2] - 0.52, layout.rear_wire_y], [0, d.window_sill_height_m + 0.3, d.depth_m / 2 + 0.14]]
  const bundle = (points: Point[], color: string, count = 3) => Array.from({ length: count }, (_, index) => (
    <Conduit key={`${color}-${index}`} points={points.map(([x, y, z]) => [x, y + index * 0.027, z] as Point)} color={color} radius={color === '#dc9147' ? 0.012 : 0.009} />
  ))
  return (
    <group>
      {/* +12 V / 5 V supply (orange), GND (graphite), and signal/control (teal/blue). */}
      {bundle(upperTrunk, '#d8873c', 2)}
      {bundle(upperTrunk, '#414f52', 2)}
      {bundle(indoorDrop, '#3c8e91', 2)}
      {bundle(outdoorRoute, '#347ca0', 2)}
      {bundle(fanRoute(-d.width_m * 0.37), '#d8873c', 1)}
      {bundle(fanRoute(d.width_m * 0.37), '#d8873c', 1)}
      {bundle(windowRoute, '#347ca0', 2)}
    </group>
  )
}
